# Knowledge Store REST API

**Status:** implemented and shipping. This document describes the API **as built**;
it is no longer an implementation plan.
**Originally requested by:** mcp-agent-manager `IndexClient`
**Spec written:** 2026-02-09 · **Rewritten against the code:** 2026-09-12 ([#590](https://github.com/jagilber-dev/index-server/issues/590))

## Summary

Three REST endpoints on the dashboard API let other tools store and retrieve
cross-repo agent performance insights:

| Method | Path | Auth |
|---|---|---|
| `POST` | `/api/knowledge` | **admin auth required** — see below |
| `GET` | `/api/knowledge/search?q=…` | none |
| `GET` | `/api/knowledge/:key` | none |

> **Read the Authentication section before writing a client.** The first
> version of this document showed `POST /api/knowledge` with no auth
> middleware and never mentioned authentication at all. mcp-agent-manager's
> `IndexClient` was written against that text: it posts without an
> `Authorization` header, treats the response as "endpoint not yet added", and
> has therefore **never delivered an insight**
> ([jagilber-dev/agent-manager#157](https://github.com/jagilber-dev/agent-manager/issues/157)).
> That is what the omission costs, and it is why the contract is stated here
> normatively rather than left implicit in a code sample.

## Authentication

`POST /api/knowledge` is registered behind `dashboardAdminAuth`
(`src/dashboard/server/routes/knowledge.routes.ts:18`). The middleware lives in
`src/dashboard/server/routes/adminAuth.ts:21-42` and **fails closed**:

| `INDEX_SERVER_ADMIN_API_KEY` | Caller | `Authorization` header | Result |
|---|---|---|---|
| unset | loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`, `localhost`) | ignored | request proceeds |
| unset | anything else | ignored | **403** `{"error":"Admin access restricted to localhost"}` |
| set | any | `Bearer <correct key>` | request proceeds |
| set | any | missing, malformed, or wrong | **401** `{"error":"Admin API key required. …"}` |

Notes that matter for client authors:

- **401 vs 403 are different conditions.** 403 means "you are not local and no
  key is configured on the server" — no header will help; the operator must set
  `INDEX_SERVER_ADMIN_API_KEY`. 401 means "a key is configured and yours is
  absent or wrong" — retrying with the right key works.
- Once a key is set it is required **even from loopback**. There is no
  "localhost is exempt" fallback in the keyed branch.
- The key is compared with `crypto.timingSafeEqual` after a length check, and
  there is **no query-parameter path** — the key travels in the header only, so
  it does not end up in access logs or `Referer`. (Constitution SH-7.)
- The two `GET` routes are deliberately unauthenticated, consistent with the
  dashboard-wide policy in `docs/dashboard.md`: mutation routes require admin
  auth when a key is set, read-only routes stay open. Changing that is a
  deliberate policy change, not a cleanup.

Minimal client:

```bash
# loopback, no key configured
curl -X POST http://127.0.0.1:8789/api/knowledge \
  -H 'Content-Type: application/json' \
  -d '{"key":"agent-performance:agent-1","content":"…"}'

# key configured (any caller)
curl -X POST http://127.0.0.1:8789/api/knowledge \
  -H "Authorization: Bearer $INDEX_SERVER_ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"key":"agent-performance:agent-1","content":"…"}'
```

A client that treats every non-2xx as "endpoint missing" will silently discard
its payload on 401/403. Distinguish 404 (route absent) from 401/403 (route
present, you are not authorised).

## Where the code lives

| Concern | File |
|---|---|
| Store | `src/dashboard/server/KnowledgeStore.ts` |
| Routes | `src/dashboard/server/routes/knowledge.routes.ts` |
| Route mounting | `src/dashboard/server/ApiRoutes.ts:197` — `router.use(createKnowledgeRoutes())` |
| Admin auth middleware | `src/dashboard/server/routes/adminAuth.ts` |
| Store tests | `src/tests/knowledgeStore.spec.ts` |
| Route auth tests | `src/tests/unit/knowledgeRoutesAdminAuth.spec.ts` |

Earlier revisions of this document told implementers to add the handlers
directly to `ApiRoutes.ts`. They live in a dedicated route module that
`ApiRoutes.ts` mounts; edit `knowledge.routes.ts`.

`/knowledge/search` is registered **before** `/knowledge/:key` so Express does
not bind `search` as a `:key` parameter. Keep that order.

## Store

`KnowledgeStore` is an in-memory map persisted to
`{dataDir}/knowledge-store.json`, where `dataDir` is
`getRuntimeConfig().index.baseDir` (i.e. `INDEX_SERVER_DIR`) unless one is
passed explicitly. Exports:

| Export | Purpose |
|---|---|
| `getKnowledgeStore()` | process-wide singleton used by the routes |
| `resetKnowledgeStore()` | drop the singleton — tests only |
| `createKnowledgeStore(dataDir)` | standalone instance rooted at `dataDir` — tests only |

Methods: `upsert(key, content, metadata?)`, `get(key)`,
`search(query, { category?, limit? })`, `delete(key)`, `count()`.
`upsert` preserves `createdAt` and refreshes `updatedAt`. Load and save
failures are logged via `logWarn` and swallowed — the store degrades to
in-memory rather than failing the request.

## Request/response contract

### POST /api/knowledge

**Request** (`Authorization` header per the Authentication section):

```json
{
  "key": "agent-performance:agent-1",
  "content": "Agent agent-1 (copilot/gpt-4o): 15 tasks, 12 success, avg 1200ms",
  "metadata": {
    "category": "agent-performance",
    "agentId": "agent-1",
    "provider": "copilot",
    "source": "mcp-agent-manager",
    "updatedAt": "2026-02-09T21:00:00.000Z"
  }
}
```

**200:**

```json
{
  "success": true,
  "entry": {
    "key": "agent-performance:agent-1",
    "content": "Agent agent-1...",
    "metadata": { "category": "agent-performance" },
    "createdAt": "2026-02-09T21:00:00.000Z",
    "updatedAt": "2026-02-09T21:05:00.000Z"
  },
  "timestamp": 1739135100000
}
```

**400** — `key` or `content` missing or not a string:

```json
{ "success": false, "error": "Missing required field: key (string)" }
```

**401 / 403** — see Authentication. These are emitted by the middleware, so the
body shape is `{ "error": "…" }`, **without** the `success` field the handler's
own errors carry. Do not branch on `success` to detect an auth failure; branch
on the status code.

**500:**

```json
{ "success": false, "error": "Failed to store knowledge entry" }
```

### GET /api/knowledge/search?q=agent-performance&category=agent-performance&limit=10

Unauthenticated. `limit` is clamped to 1–100 (default 20). An empty `q`
returns an empty result set rather than everything.

```json
{
  "success": true,
  "query": "agent-performance",
  "category": "agent-performance",
  "results": [ { "key": "...", "content": "...", "metadata": {}, "createdAt": "...", "updatedAt": "..." } ],
  "count": 1,
  "totalEntries": 5,
  "timestamp": 1739135100000
}
```

### GET /api/knowledge/agent-performance%3Aagent-1

Unauthenticated. The key is URL-decoded, so `:` must be percent-encoded.

**200:**

```json
{
  "success": true,
  "key": "agent-performance:agent-1",
  "content": "...",
  "metadata": {},
  "createdAt": "...",
  "updatedAt": "...",
  "timestamp": 1739135100000
}
```

**404:**

```json
{ "success": false, "error": "Knowledge entry not found: missing-key" }
```

## Test coverage

`src/tests/knowledgeStore.spec.ts` covers the store: `upsert` create/update
semantics, `get`, `search` (substring, category filter, limit, empty),
`delete`, `count`.

`src/tests/unit/knowledgeRoutesAdminAuth.spec.ts` covers the route auth
contract — the gap that caused agent-manager#157. Every refusal case also
asserts the entry was **not** written, so a refusal cannot be confused with a
silently-successful write:

1. loopback, no key configured → 200, entry stored
2. key configured, no `Authorization` header → 401, nothing stored
3. key configured, wrong key → 401, nothing stored
4. key configured, correct `Bearer` key → 200, entry stored
5. non-loopback caller, no key configured → 403, nothing stored
6. `GET /api/knowledge/search` stays open with a key configured (the documented
   read-route policy — a change here must be deliberate)

Cases 2, 3 and 5 go red if `dashboardAdminAuth` is removed from
`knowledge.routes.ts:18`; cases 1, 4 and 6 go red if auth is applied too
broadly. Both directions are checked, because a test suite that only proves
"refusals happen" is satisfied by a route that refuses everything.
