# Trinity — History

## Project Context
- **Project:** MCP Index Server v1.8.1 — enterprise instruction indexing for AI governance
- **Stack:** TypeScript (strict, CommonJS), Node.js ≥20, MCP SDK, vitest, Express + WebSocket
- **User:** Jason Gilbertson
- **Tools:** 50 registered MCP tools (core=7, extended=14, admin=29)
- **Handler pattern:** registerHandler('tool_name', (params) => result) in src/server/registry.ts
- **Dual entry points:** toolHandlers.ts + server/index-server.ts both import all 20 handler modules

## Learnings
<!-- Append implementation patterns, handler quirks, protocol findings below -->

### 2026-02-26: Import handler file/directory resolution fix
- **Bug**: `instructions_import` only accepted `entries` as inline array. String file paths → "no entries". Missing `source` param → silently ignored.
- **Fix location**: [src/services/handlers.instructions.ts](src/services/handlers.instructions.ts) lines 350-385 — added resolution logic before the array processing loop.
- **Schema locations**: `toolRegistry.ts` lines 99-108 (instructions_import schema) and lines 75-76 (dispatch schema entries/source params).
- **Pattern**: The import handler uses `guard()` wrapper which checks `_viaDispatcher` flag. Dispatcher passes all params via `...rest` spread, so new params automatically flow through.
- **Directory scan convention**: Files prefixed with `_` (like `_manifest.json`, `_skipped.json`) are excluded from directory import scans — these are Index metadata, not instruction entries.
- **Pre-existing flaky test**: `instructionSchema.spec.ts > body length constraint` fails with "Connection closed" — unrelated MCP transport issue, not caused by this change.

### 2026-02-27: ApiRoutes.ts monolith split into 10 focused route modules
- **Task**: Split 2,210-line `src/dashboard/server/ApiRoutes.ts` into `src/dashboard/server/routes/*.routes.ts` modules.
- **Modules created** (10 + index.ts re-export):
  - `status.routes.ts` — GET /status, /health, /system/health, /system/resources
  - `metrics.routes.ts` — GET /metrics, /metrics/history, /tools, /tools/:toolName, /performance, /realtime, /streaming/data, /charts/*, /analytics/advanced, /performance/detailed
  - `admin.routes.ts` — All /admin/* routes (config, sessions, maintenance, flags, connections, restart, cache)
  - `graph.routes.ts` — GET /graph/mermaid, /graph/categories, /graph/instructions, /graph/relations
  - `instructions.routes.ts` — CRUD /instructions, /instructions_search, /instructions_categories
  - `knowledge.routes.ts` — POST /knowledge, GET /knowledge/search, /knowledge/:key
  - `alerts.routes.ts` — GET /alerts/active, POST /alerts/:id/resolve, /alerts/generate
  - `logs.routes.ts` — GET /logs, /logs/stream (SSE)
  - `synthetic.routes.ts` — POST /admin/synthetic/activity, GET /admin/synthetic/status
  - `instances.routes.ts` — GET /instances
- **Bug fixed**: `router.post('/admin/maintenance/normalize')` was accidentally nested inside the `router.get('/status')` handler body (~line 132). Extracted as a standalone route in `admin.routes.ts`.
- **Duplicate removed**: Two `/performance/detailed` routes existed (~line 604 = older with `getDetailedPerformanceMetrics()`, ~line 1545 = newer with p95 approximation + successRate). Kept only the newer version in `metrics.routes.ts`.
- **State coupling**: `syntheticActiveRequests` state moved to `synthetic.routes.ts` as module-private. The `/performance/detailed` in `metrics.routes.ts` hardcodes `activeSyntheticRequests: 0` since cross-module state was not needed by tests.
- **Pattern**: Each module exports `createXxxRoutes(metricsCollector?: MetricsCollector): Router`. ApiRoutes.ts is now a ~105-line thin orchestrator with middleware + mount statements.
- **Tests**: All 17 tests across 3 dashboard test files pass (dashboardPhase1, dashboardV2Phase1, dashboardRpmStability).

## Sessions

### 2026-03-25T15:30:22.058Z
## Session: Enterprise Dual-Publish Setup (2026-03-25)
Assigned: Phases 2 (Repo Hygiene), 3 (Publish Script Hardening), 7 (Package.json & npm Config)
Key tasks: Remove ~170+ test marker files, clean root artifacts, update .gitignore, sync publish script forbidden lists, add dotfile stripping to publish.cjs, add --verify-only flag, add engines/files/exports to package.json.
Constitution compliance: All changes must pass typecheck + tests before commit.
