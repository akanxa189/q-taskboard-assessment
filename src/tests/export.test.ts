// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/jwt";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    membership: { findUnique: vi.fn() },
    task: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/airtable-client", () => ({
  createAirtableClient: vi.fn(() => ({
    findByTaskId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock("@/lib/airtable-export", () => ({
  exportTasksToAirtable: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { exportTasksToAirtable } from "@/lib/airtable-export";
import { POST } from "@/app/api/projects/[id]/export/route";

const PROJECT_ID = "proj_1";
const USER_ID = "user_1";
const mockUser = { id: USER_ID, email: "a@b.com", name: "Test User" };

function routeParams() {
  return { params: Promise.resolve({ id: PROJECT_ID }) };
}

function authedPost() {
  const token = signToken({ userId: USER_ID, email: mockUser.email });
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/export`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);
  vi.mocked(prisma.project.findUnique).mockResolvedValue({
    id: PROJECT_ID,
    name: "Test",
  } as never);
  vi.mocked(prisma.task.findMany).mockResolvedValue([] as never);
  vi.mocked(exportTasksToAirtable).mockResolvedValue({ exported: 0, failed: 0, errors: [] });
});

describe("POST /api/projects/[id]/export", () => {
  it("member can export - 200", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValue({ role: "member" } as never);
    vi.mocked(exportTasksToAirtable).mockResolvedValue({
      exported: 3,
      failed: 0,
      errors: [],
    });

    const res = await POST(authedPost(), routeParams());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.exported).toBe(3);
    expect(exportTasksToAirtable).toHaveBeenCalled();
  });

  it("viewer cannot export - 403", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValue({ role: "viewer" } as never);

    const res = await POST(authedPost(), routeParams());
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toMatch(/viewers cannot export/i);
    expect(exportTasksToAirtable).not.toHaveBeenCalled();
  });

  it("non-member cannot export - 403", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValue(null);

    const res = await POST(authedPost(), routeParams());
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toMatch(/not a member/i);
    expect(exportTasksToAirtable).not.toHaveBeenCalled();
  });
});
