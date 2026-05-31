import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  notFound,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";
import { createAirtableClient } from "@/lib/airtable-client";
import { getAirtableFieldMap } from "@/lib/airtable-fields";
import { exportTasksToAirtable } from "@/lib/airtable-export";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: projectId } = await params;

  const membership = await getProjectMembership(user.id, projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("viewers cannot export tasks");
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return notFound("project not found");

  let client;
  try {
    client = createAirtableClient(getAirtableFieldMap());
  } catch {
    return NextResponse.json({ error: "airtable not configured" }, { status: 503 });
  }

  const tasks = await prisma.task.findMany({
    where: { projectId },
    include: {
      assignee: { select: { email: true } },
    },
    orderBy: [{ status: "asc" }, { position: "asc" }],
  });

  const result = await exportTasksToAirtable(tasks, client);

  return NextResponse.json(result);
}
