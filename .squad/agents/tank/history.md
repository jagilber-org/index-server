# Tank — History

## Project Context
- **Project:** MCP Index Server v1.8.1 — enterprise instruction indexing for AI governance
- **Stack:** TypeScript (strict, CommonJS), Node.js ≥20, vitest (fork pool, maxWorkers=1)
- **User:** Jason Gilbertson
- **Test suite:** 112 spec files, 382 tests, all passing
- **Key test files:** toolRegistryConformance.spec.ts (10 tests), toolHandlerSmoke.spec.ts (34 tests)
- **Known issue:** Some tests write to live Index dir instead of isolated temp dirs — causes artifact pollution

## Learnings
<!-- Append test patterns, regression findings, coverage observations below -->

### 2026-02-26 — Dashboard V2 Phase 1 RED tests
- Created `src/tests/dashboardV2Phase1.spec.ts` with 5 tests (all expected RED).
- **Test 1** asserts 8 dead client files don't exist — currently FAILS because all 8 still present.
- **Test 2** asserts `DashboardServer.ts` has no `DashboardClient.js` string — FAILS because the `/js/dashboard-client.js` route still references it.
- **Test 3** verifies `createDashboardServer` starts on ephemeral port with WS disabled — should pass now (smoke baseline).
- **Test 4** verifies `/admin` returns 200 HTML — should pass now (admin route exists).
- **Test 5** asserts `/js/dashboard-client.js` does NOT return 200 — FAILS because the route still serves it.
- Net: 3 tests RED (files exist, DashboardClient.js ref, dead route serves 200), 2 GREEN (server starts, /admin works).
- Pattern: used `fs.existsSync` for file checks, bare `http.get` for route checks to avoid test-dependency bloat.

### 2026-02-26 — Dashboard V2 Phase 3 RED tests
- Created `src/tests/dashboardV2Phase3.spec.ts` with 5 structural/lint tests (all RED).
- **Test 1** (--mcp-* design tokens): 19 custom properties expected in `:root` — all missing. RED.
- **Test 2** (no hardcoded hex): Found 99 hex colors outside `:root` block. Strips comments + attribute selectors to avoid false positives. RED.
- **Test 3** (inline styles): Found 176 `style=""` attributes in admin.html, threshold is ≤10. RED.
- **Test 4** (graph buttons): Found 9 buttons with inline `linear-gradient` styles in graph section. RED.
- **Test 5** (spacing tokens): --mcp-space-xs/sm/md/lg/xl not present with expected values (4/8/16/24/32px). RED.
- Bug fix during RED: `extractGraphSection()` was matching `class="admin-section"` on the same tag as `id="graph-section"`. Fixed by skipping past the tag's closing `>` before searching for the next section.
- Pattern: pure `fs.readFileSync` + regex — no browser, no server spin-up. Fast (18ms for all 5).

## Sessions

### 2026-03-25T15:30:22.056Z
## Session: Enterprise Dual-Publish Setup (2026-03-25)
Assigned: Phases 4 (TDD Infrastructure), 5 (Playwright & E2E), 9 (Final Verification)
Requirements: TDD red/green/refactor mandatory (TS-7), Playwright e2e mandatory, scenario tests mandatory, baselines persist in private repo.
Test targets: constitution validation, .gitignore completeness, publish forbidden list sync, publish dry-run scenarios, package.json validation, dashboard e2e, instruction CRUD lifecycle, search, bootstrap flow.
Baselines stored in: test-results/, snapshots/ (private repo only, excluded from public publish).
