// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/jwt";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    task: { findUnique: vi.fn() },
    membership: { findUnique: vi.fn() },
    comment: { findMany: vi.fn(), create: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { GET, POST } from "@/app/api/tasks/[id]/comments/route";

const TASK_ID = "task_1";
const PROJECT_ID = "proj_1";
const USER_ID = "user_1";

const mockUser = { id: USER_ID, email: "a@b.com", name: "Test User" };
const mockTask = { id: TASK_ID, projectId: PROJECT_ID };

const mockComment = {
  id: "comment_1",
  taskId: TASK_ID,
  body: "hello",
  createdAt: new Date("2026-01-01T12:00:00Z"),
  author: mockUser,
};

function routeParams() {
  return { params: Promise.resolve({ id: TASK_ID }) };
}

function authedRequest(method: string, body?: { body: string }) {
  const token = signToken({ userId: USER_ID, email: mockUser.email });
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });
  return new NextRequest(`http://localhost/api/tasks/${TASK_ID}/comments`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);
  vi.mocked(prisma.task.findUnique).mockResolvedValue(mockTask as never);
});

describe("POST /api/tasks/[id]/comments", () => {
  it("member can post comment - 201", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValue({ role: "member" } as never);
    vi.mocked(prisma.comment.create).mockResolvedValue(mockComment as never);

    const res = await POST(authedRequest("POST", { body: "hello" }), routeParams());
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.comment.body).toBe("hello");
    expect(data.comment.author.email).toBe(mockUser.email);
  });

  it("viewer cannot post comment - 403", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValue({ role: "viewer" } as never);

    const res = await POST(authedRequest("POST", { body: "hello" }), routeParams());
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toMatch(/viewers cannot add comments/i);
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it("non-member cannot post comment - 403", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValue(null);

    const res = await POST(authedRequest("POST", { body: "hello" }), routeParams());
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toMatch(/not a member/i);
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/tasks/[id]/comments", () => {
  it("member can read comments - 200", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValue({ role: "member" } as never);
    vi.mocked(prisma.comment.findMany).mockResolvedValue([mockComment] as never);

    const res = await GET(authedRequest("GET"), routeParams());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.comments).toHaveLength(1);
    expect(data.comments[0].author.name).toBe(mockUser.name);
  });

  it("viewer can read comments - 200", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValue({ role: "viewer" } as never);
    vi.mocked(prisma.comment.findMany).mockResolvedValue([mockComment] as never);

    const res = await GET(authedRequest("GET"), routeParams());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.comments).toHaveLength(1);
  });

  it("non-member cannot read comments - 403", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValue(null);

    const res = await GET(authedRequest("GET"), routeParams());
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toMatch(/not a member/i);
    expect(prisma.comment.findMany).not.toHaveBeenCalled();
  });
});
