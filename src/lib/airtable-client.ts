import Airtable from "airtable";
import type { AirtableMockClient } from "@/lib/airtable-mock";
import type { AirtableFieldMap } from "@/lib/airtable-fields";

export type AirtableExportClient = {
  findByTaskId(taskId: string): Promise<{ recordId: string } | null>;
  create(fields: Record<string, unknown>): Promise<void>;
  update(recordId: string, fields: Record<string, unknown>): Promise<void>;
};

function promisify<T>(fn: (cb: (err: Error | null, result?: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, result) => {
      if (err) reject(err);
      else resolve(result as T);
    });
  });
}

function findRecordByTaskId(
  table: Airtable.Table<Airtable.FieldSet>,
  taskIdField: string,
  taskId: string,
): Promise<{ recordId: string } | null> {
  return new Promise((resolve, reject) => {
    let match: { recordId: string } | null = null;

    table
      .select({ fields: [taskIdField], pageSize: 100 })
      .eachPage(
        (records, fetchNextPage) => {
          if (match) return;
          for (const record of records) {
            if (String(record.get(taskIdField) ?? "") === taskId) {
              match = { recordId: record.id };
              return;
            }
          }
          fetchNextPage();
        },
        (err) => {
          if (err) reject(err);
          else resolve(match);
        },
      );
  });
}

export function createAirtableClient(fields: AirtableFieldMap): AirtableExportClient {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME;

  if (!apiKey || !baseId || !tableName) {
    throw new Error("airtable not configured");
  }

  const table = new Airtable({ apiKey }).base(baseId).table(tableName);

  return {
    async findByTaskId(taskId: string) {
      return findRecordByTaskId(table, fields.taskId, taskId);
    },

    async create(fields: Record<string, unknown>) {
      await promisify((cb) => {
        table.create([{ fields: fields as Airtable.FieldSet }], { typecast: true }, cb);
      });
    },

    async update(recordId: string, fields: Record<string, unknown>) {
      await promisify((cb) => {
        table.update(recordId, fields as Airtable.FieldSet, { typecast: true }, cb);
      });
    },
  };
}

export function createMockAirtableClient(
  mock: AirtableMockClient,
  fields: AirtableFieldMap,
): AirtableExportClient {
  return {
    async findByTaskId(taskId: string) {
      const records = await mock.list();
      const found = records.find(
        (r) => r.id === taskId || r.fields[fields.taskId] === taskId,
      );
      return found ? { recordId: found.id } : null;
    },

    async create(recordFields: Record<string, unknown>) {
      const taskId = recordFields[fields.taskId];
      if (typeof taskId !== "string") {
        throw new Error("Task ID field is required for create");
      }
      await mock.create({ id: taskId, fields: recordFields });
    },

    async update(recordId: string, recordFields: Record<string, unknown>) {
      await mock.update(recordId, recordFields);
    },
  };
}
