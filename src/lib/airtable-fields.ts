export type AirtableFieldMap = {
  title: string;
  description: string;
  status: string;
  assigneeEmail: string;
  createdDate: string;
  taskId: string;
  position: string;
};

/** Column names must match your Airtable table exactly (case-sensitive). */
export function getAirtableFieldMap(): AirtableFieldMap {
  return {
    title: process.env.AIRTABLE_FIELD_TITLE ?? "Title",
    description: process.env.AIRTABLE_FIELD_DESCRIPTION ?? "Description",
    status: process.env.AIRTABLE_FIELD_STATUS ?? "Status",
    assigneeEmail: process.env.AIRTABLE_FIELD_ASSIGNEE_EMAIL ?? "Assignee Email",
    createdDate: process.env.AIRTABLE_FIELD_CREATED_DATE ?? "Created Date",
    taskId: process.env.AIRTABLE_FIELD_TASK_ID ?? "Task ID",
    position: process.env.AIRTABLE_FIELD_POSITION ?? "Position",
  };
}
