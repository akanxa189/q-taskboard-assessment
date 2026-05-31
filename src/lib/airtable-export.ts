import type { AirtableExportClient } from "@/lib/airtable-client";
import { getAirtableFieldMap } from "@/lib/airtable-fields";
import { AirtableError as MockAirtableError } from "@/lib/airtable-mock";

export type TaskForExport = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  position: number;
  createdAt: Date;
  assignee: { email: string } | null;
};

export type ExportResult = {
  exported: number;
  failed: number;
  errors: { taskId: string; message: string }[];
};

export type RetryOptions = {
  maxAttempts?: number;
  delayMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTransientError(err: unknown): boolean {
  if (err instanceof MockAirtableError) {
    return (
      err.type === "rate-limit" ||
      err.type === "network" ||
      (err.type === "server-error" && (err.statusCode === 503 || err.statusCode === 500))
    );
  }

  const statusCode =
    err && typeof err === "object" && "statusCode" in err
      ? (err as { statusCode: number }).statusCode
      : null;

  if (statusCode === 429 || statusCode === 503) return true;

  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (message.includes("network") || message.includes("econnreset")) return true;

  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const delayMs = options.delayMs ?? 1000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransientError(err) || attempt === maxAttempts) {
        throw err;
      }
      await sleep(delayMs);
    }
  }

  throw lastError;
}

export function mapTaskToFields(task: TaskForExport): Record<string, unknown> {
  const f = getAirtableFieldMap();
  return {
    [f.title]: task.title,
    [f.description]: task.description ?? "",
    [f.status]: task.status,
    [f.assigneeEmail]: task.assignee?.email ?? "",
    [f.createdDate]: task.createdAt.toISOString(),
    [f.taskId]: task.id,
    [f.position]: task.position,
  };
}

async function upsertTask(
  client: AirtableExportClient,
  taskId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await withRetry(async () => {
    const existing = await client.findByTaskId(taskId);
    if (existing) {
      await client.update(existing.recordId, fields);
    } else {
      await client.create(fields);
    }
  });
}

export async function exportTasksToAirtable(
  tasks: TaskForExport[],
  client: AirtableExportClient,
): Promise<ExportResult> {
  const result: ExportResult = { exported: 0, failed: 0, errors: [] };

  for (const task of tasks) {
    try {
      const fields = mapTaskToFields(task);
      await upsertTask(client, task.id, fields);
      result.exported += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push({
        taskId: task.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
