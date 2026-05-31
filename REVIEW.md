# TaskBoard — Code Review

**Scope:** Full repository review (API routes, Prisma schema, auth, client, tests).  
**Date:** 2026-05-31  
**Method:** Static analysis of source; issues ranked by **business impact** (data loss, breach, unauthorized access, and production reliability).

---

## Summary

TaskBoard is a coherent Next.js 15 + Prisma monolith with clear layering (`app/api`, `lib`, `schemas`, `components`). The highest-risk problems are **authorization gaps** and **unsafe SQL** in the task search path—both can compromise customer data across projects. Password hashes are also returned to the browser on project detail. Test coverage does not exercise API routes or RBAC, so these defects are unlikely to be caught before release.

---

## Top 4 Issues (by business impact)

### 1. SQL injection in task search

| Field | Value |
|-------|--------|
| **Location** | `src/app/api/projects/[id]/tasks/route.ts` — lines **27–34** |
| **Category** | Security |
| **Severity** | **Critical** |

When the `q` query parameter is present, the handler builds SQL by interpolating `projectId` and `q` directly into a string passed to `prisma.$queryRawUnsafe()`. An attacker who is a project member (or who can guess a project id) can inject arbitrary SQL—reading or modifying any table, not only tasks. This is a full database compromise vector with the privileges of the application DB user.

**Recommended fix:** Remove `$queryRawUnsafe` entirely. Use Prisma’s parameterized API, e.g. `prisma.task.findMany({ where: { projectId, OR: [{ title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] }, ... })`, or `prisma.$queryRaw` with tagged template placeholders (`Prisma.sql`). Never concatenate user input into SQL strings.

---

### 2. Task updates bypass project membership and role checks

| Field | Value |
|-------|--------|
| **Location** | `src/app/api/tasks/[id]/route.ts` — lines **16–36** (`PATCH` handler) |
| **Category** | Security |
| **Severity** | **Critical** |

`PATCH /api/tasks/:id` authenticates the caller but never calls `getProjectMembership()` or `canEditTasks()`. Any logged-in user who knows (or enumerates) a task id can change title, status, assignee, and position on **any** project—including projects they do not belong to. `DELETE` on the same file correctly enforces membership (lines 49–52); `PATCH` does not, which is an inconsistent and dangerous gap.

**Recommended fix:** Mirror the `DELETE` flow: load the task, resolve `existing.projectId`, fetch membership for `(user.id, projectId)`, return `403` if missing or if `!canEditTasks(membership.role)`, then apply the update. Add integration tests that a member of project A cannot `PATCH` a task in project B.

---

### 3. Password hashes exposed in project detail API

| Field | Value |
|-------|--------|
| **Location** | `src/app/api/projects/[id]/route.ts` — lines **28–30** (`include: { owner: true, memberships: { include: { user: true } } }`) |
| **Category** | Security |
| **Severity** | **High** |

`GET /api/projects/:id` returns full `User` records for the owner and every member via `owner: true` and `user: true`. Prisma includes all scalar fields, including `passwordHash`. The dashboard project page consumes this payload (`/projects/[id]`), so bcrypt hashes are sent to the browser and may be logged by proxies or client-side tools. Even hashed passwords must not leave the server; offline cracking becomes feasible if the hash leaks.

**Recommended fix:** Always `select` explicit safe fields, e.g. `owner: { select: { id: true, name: true, email: true } }` and the same for `memberships.user`. Audit other routes (`tasks` with `createdBy: true`, etc.) for the same pattern. Add a response test asserting `passwordHash` is never present in JSON.

---

### 4. No API or authorization integration tests

| Field | Value |
|-------|--------|
| **Location** | `src/tests/` — only `auth.test.ts` (JWT helpers), `schemas.test.ts`, `TaskCard.test.tsx`; **no** tests under `src/app/api/` |
| **Category** | Testing |
| **Severity** | **High** |

The test suite validates Zod schemas, JWT sign/verify, and one presentational component. It does **not** exercise HTTP handlers, Prisma, membership rules, or the task search path. Issues #1 and #2 above would not fail CI today. For a multi-tenant task board, broken RBAC directly impacts customer trust and data integrity; lack of route-level tests makes regressions likely on every change.

**Recommended fix:** Add Vitest integration tests (with a test database or Prisma mock) for critical paths: login/register, list projects as member vs non-member, viewer forbidden on task create/update, cross-project `PATCH` denied, and search with malicious `q` returning only in-scope rows. Consider `supertest` or Next.js route handler invocation with seeded data from `prisma/seed.ts`. Gate merges on these tests in CI.

---

## Honorable mentions (not in top 4)

| Issue | Location | Category | Note |
|-------|----------|----------|------|
| Dashboard loads all task rows to compute count | `src/app/api/projects/route.ts:16` | Performance | Use `_count: { select: { tasks: true } }` instead of `tasks: true`. |
| `assigneeId` not validated against project members | `src/app/api/projects/[id]/tasks/route.ts:79` | Data Integrity | API accepts any user id; assignees should be project members. |
| JWT stored in `localStorage` | `src/lib/api-client.ts:8–26` | Security | XSS can steal tokens; prefer `httpOnly` cookies for production. |
| No unique constraint on `User.email` | `prisma/schema.prisma:25` | Data Integrity | Register checks uniqueness in app code only; races can duplicate emails. |

---

## Positive observations

- Consistent use of Zod for request validation (`src/schemas/`).
- Shared auth helpers (`getCurrentUser`, `getProjectMembership`, `canEdit*`) centralize RBAC intent—when applied consistently.
- Prisma schema models memberships and cascade deletes sensibly; seed data supports realistic manual and automated testing.
- TypeScript strict mode and clear App Router structure keep the codebase navigable.

---

*This document is for internal review and remediation planning. Re-run analysis after fixes to confirm closure.*
