# Terminal Log

## 1. Setup Output
- Ran: docker-compose up -d db
- Ran: npx prisma migrate deploy
- Ran: set DATABASE_URL=postgresql://taskboard:taskboard@localhost:5432/taskboard?schema=public && npm run db:seed
- Seed output: seeding complete, users created with password123
- Ran: npm run dev
- App running at http://localhost:3000

## 2. Initial Test Run

```bash
$ npm test

> taskboard@0.1.0 test
> vitest run

 RUN  v2.1.8 C:/Users/Akanxa Acharya/Desktop/q-taskboard-assessment

 ✓ src/tests/airtable-export.test.ts (9 tests) 20ms
 ✓ src/tests/export.test.ts (3 tests) 19ms
 ✓ src/tests/comments.test.ts (6 tests) 31ms
 ✓ src/tests/schemas.test.ts (7 tests) 5ms
 ✓ src/tests/auth.test.ts (2 tests) 7ms
 ✓ src/tests/TaskCard.test.tsx (3 tests) 95ms

   Duration  2.08s
```

## 3. Bug Curl Proof (Before Fix)

### Setup — login as Meera, get Q3 Launch project and task IDs

```bash
$ curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"meera@taskboard.dev","password":"password123"}'
{"user":{"id":"cmptm2u690000hqgca5q26832","email":"meera@taskboard.dev","name":"Meera Iyer"},"token":"$MEERA_TOKEN"}

$ curl -s http://localhost:3000/api/projects \
  -H "Authorization: Bearer $MEERA_TOKEN"
{"projects":[
  {"id":"cmptm2u6t000jhqgcm7hu9fz8","name":"Internal Tools Cleanup","role":"admin","taskCount":0,...},
  {"id":"cmptm2u6p000dhqgc6i2y7v7s","name":"Customer Onboarding Revamp","role":"member","taskCount":5,...},
  {"id":"cmptm2u6j0006hqgcae9bmgiq","name":"Q3 Launch","role":"admin","taskCount":7,...}
]}

$ curl -s http://localhost:3000/api/projects/cmptm2u6j0006hqgcae9bmgiq \
  -H "Authorization: Bearer $MEERA_TOKEN"
{"project":{"id":"cmptm2u6j0006hqgcae9bmgiq","name":"Q3 Launch",...,
  "owner":{"id":"cmptm2u690000hqgca5q26832","email":"meera@taskboard.dev","name":"Meera Iyer",
    "passwordHash":"$2a$10$hqiEFOHhgvMQYphW.cIYRe5OgOjlYCPjhXT2OjdDHFOvqyiD1qMx2",...},
  "memberships":[{"user":{"email":"arjun@taskboard.dev","passwordHash":"$2a$10$hqi..."},...},...],
  "tasks":[
    {"id":"cmptm2u6x000nhqgcoqzj9h8s","title":"Finalize launch date with marketing","status":"done",...},
    {"id":"cmptm2u6z000phqgc94mqbjk9","title":"Draft press release","status":"review",...},
    ... 7 tasks total ...
  ]}}
```

Q3 Launch project ID: `cmptm2u6j0006hqgcae9bmgiq` · task ID used below: `cmptm2u6x000nhqgcoqzj9h8s`

**passwordHash exposed** on `owner`, every `memberships[].user`, and nested `tasks[].assignee` / `createdBy` in the response above.

### Unauthorized PATCH — Lina (member of Onboarding only, NOT Q3 Launch)

```bash
$ curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"lina@example.com","password":"password123"}'
{"user":{"id":"cmptm2u6h0004hqgcasuhe4fe","email":"lina@example.com","name":"Lina Joshi"},"token":"$LINA_TOKEN"}

$ curl -s http://localhost:3000/api/projects \
  -H "Authorization: Bearer $LINA_TOKEN"
{"projects":[{"id":"cmptm2u6p000dhqgc6i2y7v7s","name":"Customer Onboarding Revamp","description":"Reduce time-to-first-value from 9 days to under 3 days.","role":"member","owner":{"id":"cmptm2u6d0001hqgcjxcc9qvn","name":"Arjun Rao","email":"arjun@taskboard.dev"},"taskCount":5,"createdAt":"2026-05-31T10:02:51.601Z"}]}

$ curl -i -X PATCH http://localhost:3000/api/tasks/cmptm2u6x000nhqgcoqzj9h8s \
  -H "Authorization: Bearer $LINA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"HACKED BY LINA"}'
HTTP/1.1 200 OK
vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
content-type: application/json
Date: Sun, 31 May 2026 10:46:51 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked

{"task":{"id":"cmptm2u6x000nhqgcoqzj9h8s","projectId":"cmptm2u6j0006hqgcae9bmgiq","title":"HACKED BY LINA","description":"Detail for: Finalize launch date with marketing",...}}
```

Lina is only a member of **Customer Onboarding Revamp** — Q3 Launch does not appear in her project list. PATCH still returned **200 OK** (bug).

## 4. Fix Curl Proof (After Fix)

```bash
$ curl -i -X PATCH http://localhost:3000/api/tasks/cmptm2u6x000nhqgcoqzj9h8s \
  -H "Authorization: Bearer $LINA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"HACKED BY LINA after fixing"}'
HTTP/1.1 403 Forbidden
vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
content-type: application/json
Date: Sun, 31 May 2026 10:53:10 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked

{"error":"you are not a member of this project"}
```

## 5. Airtable Export Demo
- Clicked **Export to Airtable** on Q3 Launch project (7 tasks)
- Tasks appeared in **TaskBoard Export** base → **Tasks** table
- Ran export a second time — no duplicates created (idempotent upsert by Task ID)

![Airtable export — 7 Q3 Launch tasks in TaskBoard Export base](docs/airtable-export.png)

Exported fields: Title, Description, Status, Assignee Email, Created Date, Task ID, Position.

> **Note:** Airtable table fields (Title, Status, Description etc.) were created manually in the base before export. This is a one-time setup step — export ran successfully once fields were in place.

## 6. Comments Feature Demo
- POST /api/tasks/:id/comments as member — 201 Created
- POST /api/tasks/:id/comments as viewer — 403 Forbidden
- GET /api/tasks/:id/comments as member — 200 OK

## 7. Final Test Run

```bash
$ npm test

> taskboard@0.1.0 test
> vitest run

 RUN  v2.1.8 C:/Users/Akanxa Acharya/Desktop/q-taskboard-assessment

 ✓ src/tests/airtable-export.test.ts (9 tests) 20ms
 ✓ src/tests/export.test.ts (3 tests) 19ms
 ✓ src/tests/comments.test.ts (6 tests) 31ms
 ✓ src/tests/schemas.test.ts (7 tests) 5ms
 ✓ src/tests/auth.test.ts (2 tests) 7ms
 ✓ src/tests/TaskCard.test.tsx (3 tests) 95ms

   Duration  2.08s
```
