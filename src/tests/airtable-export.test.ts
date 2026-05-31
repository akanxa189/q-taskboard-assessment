// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AirtableMockClient, AirtableError } from "@/lib/airtable-mock";
import { createMockAirtableClient } from "@/lib/airtable-client";
import type { AirtableExportClient } from "@/lib/airtable-client";
import {
  exportTasksToAirtable,
  mapTaskToFields,
  withRetry,
  isTransientError,
  type TaskForExport,
} from "@/lib/airtable-export";
import { getAirtableFieldMap } from "@/lib/airtable-fields";

const sampleTask = (id: string): TaskForExport => ({
  id,
  title: `Task ${id}`,
  description: "desc",
  status: "todo",
  position: 0,
  createdAt: new Date("2026-01-15T10:00:00Z"),
  assignee: { email: "user@example.com" },
});

describe("mapTaskToFields", () => {
  it("maps all required fields", () => {
    const fields = mapTaskToFields(sampleTask("t1"));
    expect(fields["Title"]).toBe("Task t1");
    expect(fields["Task ID"]).toBe("t1");
    expect(fields["Assignee Email"]).toBe("user@example.com");
    expect(fields["Position"]).toBe(0);
  });
});

describe("isTransientError", () => {
  it("treats rate-limit as transient", () => {
    expect(isTransientError(new AirtableError("rate", "rate-limit", 429))).toBe(true);
  });

  it("treats 404 as permanent", () => {
    expect(isTransientError(new AirtableError("not found", "server-error", 404))).toBe(false);
  });
});

describe("withRetry", () => {
  it("retries transient failures and succeeds", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new AirtableError("rate", "rate-limit", 429);
      }
      return "ok";
    });

    const promise = withRetry(fn, { maxAttempts: 3, delayMs: 1000 });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("does not retry permanent failures", async () => {
    const fn = vi.fn(async () => {
      throw new AirtableError("bad", "server-error", 404);
    });
    await expect(withRetry(fn, { maxAttempts: 3, delayMs: 1000 })).rejects.toThrow("bad");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("exportTasksToAirtable", () => {
  let mock: AirtableMockClient;
  let client: AirtableExportClient;

  beforeEach(() => {
    mock = new AirtableMockClient();
    client = createMockAirtableClient(mock, getAirtableFieldMap());
  });

  it("exports all tasks", async () => {
    const tasks = [sampleTask("t1"), sampleTask("t2")];
    const result = await exportTasksToAirtable(tasks, client);

    expect(result.exported).toBe(2);
    expect(result.failed).toBe(0);
    expect(mock.__getRecordCount()).toBe(2);
  });

  it("is idempotent on re-export", async () => {
    const tasks = [sampleTask("t1"), sampleTask("t2")];
    await exportTasksToAirtable(tasks, client);
    const result = await exportTasksToAirtable(tasks, client);

    expect(result.exported).toBe(2);
    expect(mock.__getRecordCount()).toBe(2);
  });

  it("continues when a single record fails permanently", async () => {
    const failingClient: AirtableExportClient = {
      findByTaskId: vi.fn(async (taskId) =>
        taskId === "bad" ? null : client.findByTaskId(taskId),
      ),
      create: vi.fn(async (fields) => {
        if (fields[getAirtableFieldMap().taskId] === "bad") {
          throw new AirtableError("invalid", "server-error", 422);
        }
        return client.create(fields);
      }),
      update: client.update.bind(client),
    };

    const tasks = [sampleTask("t1"), sampleTask("bad"), sampleTask("t3")];
    const result = await exportTasksToAirtable(tasks, failingClient);

    expect(result.exported).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].taskId).toBe("bad");
  });

  it("retries transient failures per task", async () => {
    const attempts = new Map<string, number>();

    const retryClient: AirtableExportClient = {
      findByTaskId: async () => null,
      create: async (fields) => {
        const taskId = fields[getAirtableFieldMap().taskId] as string;
        const count = (attempts.get(taskId) ?? 0) + 1;
        attempts.set(taskId, count);
        if (count < 2) {
          throw new AirtableError("rate", "rate-limit", 429);
        }
      },
      update: async () => {},
    };

    vi.useFakeTimers();
    const promise = exportTasksToAirtable([sampleTask("t1")], retryClient);
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result.exported).toBe(1);
    expect(result.failed).toBe(0);
    expect(attempts.get("t1")).toBe(2);
  });
});
