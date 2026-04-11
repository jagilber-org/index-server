# Dashboard v2 Architecture Plan

**Author:** Morpheus (Lead/Architect)  
**Date:** 2026-02-26  
**Status:** DRAFT — awaiting Jason's approval  
**Constitution compliance:** Q-1 through Q-8, S-1 through S-4, A-1 through A-5, G-1 through G-5

---

## 1. Executive Summary

The current dashboard is functional but carries ~3,400 lines of dead Phase3/Phase4 code, a 2,092-line monolith API router, and a graph tab that requires complex manual selector workflows to produce diagrams. The SVG drilldown section has never worked end-to-end. This plan defines 5 iterative phases — each independently shippable — to modernize the dashboard while preserving every existing feature and API route.

**Total current dashboard footprint: ~18,700 lines across 37 files.**

---

## 2. Current Inventory (Audited)

### 2.1 Client Files (src/dashboard/client/)

| File | Lines | Status |
|------|------:|--------|
| admin.html | 1,904 | **KEEP** — v2 foundation, refactor |
| css/admin.css | 433 | **KEEP** — refactor with CSS variables |
| js/admin.boot.js | 271 | **KEEP** — refactor |
| js/admin.graph.js | 467 | **KEEP** — major refactor (graph redesign) |
| js/admin.instructions.js | 393 | **KEEP** — refactor |
| js/admin.sessions.js | 273 | **KEEP** — refactor |
| js/admin.maintenance.js | 277 | **KEEP** — refactor |
| js/admin.monitor.js | 175 | **KEEP** — refactor |
| js/admin.overview.js | 155 | **KEEP** — refactor |
| js/admin.config.js | 112 | **KEEP** — refactor |
| js/admin.logs.js | 107 | **KEEP** — refactor |
| js/admin.instances.js | 101 | **KEEP** — refactor |
| js/admin.performance.js | 61 | **KEEP** — refactor |
| js/admin.drilldown.js | 38 | **EVALUATE** — remove if SVG drilldown is dropped |
| js/admin.utils.js | 44 | **KEEP** — refactor |
| **Phase3DashboardClient.ts** | **930** | **REMOVE** — dead code, self-referential only |
| **Phase4DashboardClient.ts** | **1,112** | **REMOVE** — dead code, self-referential only |
| **Phase4Demo.html** | **396** | **REMOVE** — dead demo page |
| **Phase4Integration.ts** | **295** | **REMOVE** — dead code, imports only Phase4DashboardClient |
| **Phase4Styles.css** | **431** | **REMOVE** — unused styles for dead demo |
| **DashboardClient.ts** | **627** | **REMOVE** — legacy client, only referenced by DashboardServer line 201 (dead path) |
| **DashboardStyles.ts** | **470** | **REMOVE** — legacy style generator, unreferenced |
| **DashboardTypes.ts** | **174** | **REMOVE** — legacy types, self-referential only |

**Dead code subtotal: 4,435 lines across 7 files.**

### 2.2 Server Files (src/dashboard/server/)

| File | Lines | Status |
|------|------:|--------|
| ApiRoutes.ts | 2,092 | **KEEP** — refactor: split into route modules |
| DashboardServer.ts | 1,312 | **KEEP** — refactor: remove DashboardClient.js dead reference (line 201) |
| MetricsCollector.ts | 1,454 | **KEEP** — core infrastructure |
| AdminPanel.ts | 1,025 | **KEEP** — core admin logic |
| WebSocketManager.ts | 522 | **KEEP** — real-time updates |
| SessionPersistenceManager.ts | 436 | **KEEP** — session data |
| FileMetricsStorage.ts | 214 | **KEEP** — persistence layer |
| InstanceManager.ts | 161 | **KEEP** — multi-instance |
| KnowledgeStore.ts | 95 | **KEEP** — knowledge API |

### 2.3 Other Server Modules

| File | Lines | Status |
|------|------:|--------|
| analytics/AnalyticsEngine.ts | 562 | **KEEP** — evaluate feature usage |
| analytics/BusinessIntelligence.ts | 751 | **KEEP** — evaluate feature usage |
| security/SecurityMonitor.ts | 679 | **KEEP** — security monitoring |
| integration/APIIntegration.ts | 1,220 | **KEEP** — external API surface |
| export/DataExporter.ts | 1,166 | **KEEP** — data export |

### 2.4 Test Files

| File | Lines | Status |
|------|------:|--------|
| src/tests/dashboardPhase1.spec.ts | 196 | **KEEP** — update for v2 |
| src/tests/dashboardRpmStability.spec.ts | 57 | **KEEP** |
| src/tests/unit/dashboardWebSocket.metrics.spec.ts | (exists) | **KEEP** |
| tests/playwright/dashboard.controls.spec.ts | 72 | **KEEP** — update for v2 UI |

### 2.5 API Routes Inventory (60 routes — ALL must survive)

**Core:**
- `GET /status`, `GET /health`, `GET /system/health`, `GET /system/resources`
- `GET /tools`, `GET /tools/:toolName`
- `GET /metrics`, `GET /metrics/history`
- `GET /performance`, `GET /performance/detailed`
- `GET /realtime`, `GET /streaming/data`

**Charts:**
- `GET /charts/tool-usage`, `GET /charts/performance`, `GET /charts/timerange`, `GET /charts/export`

**Admin:**
- `GET /admin/config`, `POST /admin/config`, `GET /admin/flags`
- `GET /admin/sessions`, `POST /admin/sessions`, `DELETE /admin/sessions/:sessionId`
- `GET /admin/sessions/history`, `GET /admin/connections`
- `GET /admin/maintenance`, `POST /admin/maintenance/mode`
- `POST /admin/maintenance/normalize`
- `POST /admin/maintenance/backup`, `GET /admin/maintenance/backups`
- `POST /admin/maintenance/restore`, `DELETE /admin/maintenance/backup/:id`
- `POST /admin/maintenance/backups/prune`
- `GET /admin/stats`, `POST /admin/clear-metrics`
- `POST /admin/restart`, `POST /admin/cache/clear`
- `POST /admin/synthetic/activity`, `GET /admin/synthetic/status`

**Analytics/Alerts:**
- `GET /analytics/advanced`
- `GET /alerts/active`, `POST /alerts/:id/resolve`, `POST /alerts/generate`

**Graph:**
- `GET /graph/mermaid`, `GET /graph/categories`, `GET /graph/instructions`, `GET /graph/relations`

**Knowledge:**
- `POST /knowledge`, `GET /knowledge/search`, `GET /knowledge/:key`

**Instructions:**
- `GET /instructions`, `GET /instructions_search`, `GET /instructions_categories`
- `GET /instructions/:name`, `POST /instructions`, `PUT /instructions/:name`, `DELETE /instructions/:name`

**Logs:**
- `GET /logs`, `GET /logs/stream`

**Instances:**
- `GET /instances`

---

## 3. Phase Breakdown

### Phase 1: Dead Code Removal & Foundation (~1-2 days of work)

**Goal:** Remove 4,435 lines of dead code. Clean foundation for all subsequent work.

**Remove these files:**
1. `src/dashboard/client/Phase3DashboardClient.ts` (930 lines)
2. `src/dashboard/client/Phase4DashboardClient.ts` (1,112 lines)
3. `src/dashboard/client/Phase4Demo.html` (396 lines)
4. `src/dashboard/client/Phase4Integration.ts` (295 lines)
5. `src/dashboard/client/Phase4Styles.css` (431 lines)
6. `src/dashboard/client/DashboardClient.ts` (627 lines)
7. `src/dashboard/client/DashboardStyles.ts` (470 lines)
8. `src/dashboard/client/DashboardTypes.ts` (174 lines)

**Fix in DashboardServer.ts:**
- Line 201 references `dist/dashboard/client/DashboardClient.js` — remove this dead code path.

**TDD RED tests (write first):**
1. Test that removed files do not exist in dist/ after build
2. Test that `DashboardServer` starts without errors after removal
3. Test that all 60 API routes still respond (update existing dashboardPhase1.spec.ts)
4. Test that admin.html loads successfully (Playwright controls test)

**Commit:** `refactor: remove 4,435 lines of dead Phase3/Phase4 dashboard code`

**Validation:** `npm run build && npm test` — zero regressions.

---

### Phase 2: API Route Modularization (~2-3 days)

**Goal:** Split the 2,092-line ApiRoutes.ts monolith into focused route modules.

**New file layout:**
```
src/dashboard/server/routes/
  index.ts              — re-exports all route factories
  status.routes.ts      — /status, /health, /system/*
  metrics.routes.ts     — /metrics/*, /performance/*, /charts/*
  admin.routes.ts       — /admin/config, /admin/sessions, /admin/maintenance
  graph.routes.ts       — /graph/* (mermaid, categories, instructions, relations)
  instructions.routes.ts — /instructions, /instructions_search, /instructions_categories, CRUD
  knowledge.routes.ts   — /knowledge/*
  alerts.routes.ts      — /alerts/*
  logs.routes.ts        — /logs, /logs/stream
  synthetic.routes.ts   — /admin/synthetic/*
```

**Refactoring rules:**
- Each route module exports a `create<Domain>Routes(): Router` function
- ApiRoutes.ts becomes a thin orchestrator that composes sub-routers
- No API contract changes — all 60 routes keep identical paths and response shapes
- HTTP metrics middleware stays in the orchestrator

**TDD RED tests (write first):**
1. Contract test per route module: verify each endpoint returns expected status code and response shape
2. Regression test: snapshot current API responses, ensure new modules produce identical output
3. Import test: verify each route module can be instantiated independently

**Commit pattern:** One commit per route module extraction (`refactor: extract status routes from ApiRoutes monolith`)

---

### Phase 3: CSS/UX Modernization (~2 days)

**Goal:** Professional visual refresh. Vanilla CSS, no frameworks.

**Design principles:**
- **Dark theme default** — current dark theme is the right direction, systematize it
- **CSS custom properties** — replace all hardcoded colors with `--mcp-*` variables
- **Design tokens** — define in `:root` at top of admin.css:
  ```css
  :root {
    --mcp-bg-primary: #0f1624;
    --mcp-bg-card: #1a2332;
    --mcp-bg-input: #1f2a3a;
    --mcp-border: #2d3b4f;
    --mcp-text-primary: #e3ebf5;
    --mcp-text-secondary: #9fb5cc;
    --mcp-accent-blue: #3498db;
    --mcp-accent-green: #2ecc71;
    --mcp-accent-orange: #e67e22;
    --mcp-accent-red: #e74c3c;
    --mcp-font-mono: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
    --mcp-font-sans: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    --mcp-radius: 8px;
    --mcp-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  ```
- **Remove inline styles** — the admin.html graph section has ~30 inline style attributes; move all to CSS classes
- **Responsive layout** — current grid works on desktop; add `@media` breakpoints for tablet
- **Consistent spacing** — define `--mcp-space-*` tokens (4px, 8px, 12px, 16px, 24px, 32px)
- **Animation** — subtle transitions on card hover, tab switch (CSS `transition`, no JS)

**Remove from admin.html:**
- All `style="..."` attributes (replace with CSS classes)
- Emoji-heavy button text — keep icons but add `aria-label` for accessibility

**TDD RED tests (write first):**
1. Playwright visual regression: screenshot each tab before/after CSS changes
2. Accessibility: test that all interactive elements have proper ARIA attributes
3. CSS variable test: parse admin.css, verify zero hardcoded hex colors outside `:root`

**Commit:** `style: systematize dashboard CSS with custom properties and enterprise theme`

---

### Phase 4: Graph Tab Redesign (~3-4 days)

**Goal:** Transform the graph tab from a clunky multi-selector workflow into a streamlined visualization experience.

**Current problems:**
1. **Too many selectors** — 2 multi-selects (categories, instructions) + 3 checkboxes (enrich, categories, usage) + edge types input + layout selector + 3 toggle checkboxes = 10+ controls before the user sees anything
2. **SVG drilldown never worked** — the "Render SVG" button has no onclick handler wired; the drill-svg element stays at `(idle)` forever
3. **Mermaid source is shown as raw text** — users see frontmatter YAML before the diagram
4. **Layout toggle (ELK vs default) requires mermaid re-init** — confusing for users
5. **No visual feedback during loading** — just text "(loading graph...)"

**Architecture decision: Remove SVG Drilldown.**

Rationale: The drilldown section was an experiment that was never completed. The SVG rendering buttons have no wired event handlers. The drill-svg element starts empty. There is no server-side endpoint for SVG generation (only Mermaid text). Building a custom SVG renderer is a significant effort with no user demand. The Mermaid diagram already supports focus filtering via the category/instruction selectors.

Files affected by SVG removal:
- `admin.html`: Remove the "Layered Drilldown SVG (Experimental)" card (~30 lines)
- `js/admin.drilldown.js` (38 lines): **REMOVE entirely** — only loads category/instruction lists for the drilldown panel; this functionality is already duplicated in admin.graph.js
- `css/admin.css`: Remove `.drill-toolbar`, `#drill-svg-wrapper`, `#drill-legend` styles

**New Graph Tab UX:**

```
┌─────────────────────────────────────────────────┐
│ 🗺️ Instruction Relationship Graph               │
├─────────────────────────────────────────────────┤
│ ┌──────────────┐ ┌──────────┐ ┌──────────┐     │
│ │ Categories ▾ │ │ Layout ▾ │ │ 🔄 Refresh│     │
│ └──────────────┘ └──────────┘ └──────────┘     │
│                                                 │
│ ┌─ Advanced Options (collapsed by default) ────┐│
│ │ □ Categories  □ Usage  □ Enrich              ││
│ │ Edge Types: [________]  □ Large graph mode   ││
│ └──────────────────────────────────────────────┘│
│                                                 │
│ ┌─ Rendered Diagram ──────────────────────────┐ │
│ │                                             │ │
│ │   [Mermaid SVG rendered here — full width]  │ │
│ │                                             │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ ┌─ Source (collapsed by default) ─────────────┐ │
│ │ [📋 Copy] [✏️ Edit]                         │ │
│ │ flowchart TB ...                            │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**Key UX improvements:**
1. **Smart defaults** — graph loads automatically on tab switch with default filters (categories=true, enrich=true)
2. **Category dropdown** — replace clunky multi-select with a dropdown + chip selector (selected categories shown as removable chips)
3. **Collapse advanced options** — hide edge types, large graph mode, debug behind a toggle
4. **Diagram first** — rendered SVG is the hero; source code is collapsed below
5. **Loading skeleton** — show animated placeholder while Mermaid renders
6. **Zoom controls** — add +/- buttons and mousewheel zoom on the rendered diagram container
7. **Fullscreen mode** — button to expand diagram to viewport

**API changes for graph:**
- No new endpoints needed — existing `/api/graph/mermaid`, `/api/graph/categories`, `/api/graph/instructions`, `/api/graph/relations` are sufficient
- Consider adding `GET /api/graph/mermaid/svg` that returns pre-rendered SVG via server-side Mermaid CLI (future phase, not blocking)

**TDD RED tests (write first):**
1. Unit test: graph auto-loads on tab navigation (mock fetch, verify DOM update)
2. Playwright: graph tab renders a visible SVG element after load
3. Playwright: category chip selector adds/removes categories
4. Playwright: source section toggle shows/hides raw Mermaid text
5. Unit test: SVG drilldown section no longer exists in DOM
6. API contract: `/api/graph/mermaid` response shape unchanged

**Commit sequence:**
1. `refactor: remove dead SVG drilldown from graph tab`
2. `feat: redesign graph tab with collapsible controls and diagram-first layout`
3. `feat: add zoom controls and fullscreen mode to graph diagram`

---

### Phase 5: Feature Enrichment & Polish (~2 days)

**Goal:** Complete the enterprise experience across all tabs.

**Enhancements:**
1. **Overview tab** — add sparkline mini-charts for RPM/latency (CSS-only using `background: linear-gradient`)
2. **Sessions tab** — add real-time session count badge, auto-refresh toggle
3. **Maintenance tab** — add backup history timeline, inline restore confirmation dialog
4. **Instructions tab** — add inline search/filter, pagination controls, category tag display
5. **Monitoring tab** — add WebSocket connection status indicator
6. **Configuration tab** — add "unsaved changes" indicator, reset-to-defaults button

**Global enhancements:**
- **Toast notifications** — replace `alert()` calls with CSS-animated toast component
- **Keyboard navigation** — Tab key navigates between tab panels, Enter activates
- **Breadcrumb navigation** — show current section path in header
- **Export** — add "Export Dashboard State" button (JSON dump of all current data)

**TDD RED tests (write first):**
1. Toast component: test show/auto-dismiss/stack behavior
2. Keyboard navigation: Playwright test for tab/enter navigation
3. Each tab enhancement: verify new DOM elements render correctly
4. Export: verify JSON output contains expected keys

**Commit pattern:** One commit per tab enhancement, final commit for global features.

---

## 4. Test Strategy

### TDD Discipline (Constitution Q-1, Q-2)

Every phase follows **RED → GREEN → REFACTOR**:

1. **RED:** Write failing tests that define expected behavior
2. **GREEN:** Implement minimal code to pass tests
3. **REFACTOR:** Clean up while keeping tests green

### Test Categories

| Category | Tool | Location | Phase |
|----------|------|----------|-------|
| Dead code removal verification | vitest | src/tests/dashboardCleanup.spec.ts | 1 |
| API route contract tests | vitest | src/tests/dashboardRoutes.spec.ts | 2 |
| Route module isolation | vitest | src/tests/routes/*.spec.ts | 2 |
| CSS variable coverage | vitest (parse CSS) | src/tests/dashboardCss.spec.ts | 3 |
| Visual regression | Playwright | tests/playwright/dashboard.visual.spec.ts | 3 |
| Graph UX behavior | Playwright | tests/playwright/dashboard.graph.spec.ts | 4 |
| Graph API contracts | vitest | src/tests/dashboardGraph.spec.ts | 4 |
| Feature enrichment | vitest + Playwright | various | 5 |

### Coverage Target

- `src/dashboard/server/`: >80% (constitution Q-2)
- `src/dashboard/server/routes/`: >90% (new code, higher bar)
- Client JS coverage via Playwright interaction tests (not instrumented, but behavior-verified)

### Chrome DevTools MCP Validation

Per user requirement, use `chrome-devtools` MCP during development for:
- **Snapshot validation:** Take DOM snapshots after each phase to verify element presence/absence
- **Console error monitoring:** Verify zero console errors on each tab
- **Performance traces:** Verify dashboard page load <2s, graph render <5s
- **Network monitoring:** Verify API calls match expected patterns

---

## 5. CSS/UX Direction

### Design Vision: "Enterprise Control Panel"

- **Inspiration:** Azure Portal, Grafana dark mode, GitHub Actions dashboard
- **Color philosophy:** Low-contrast comfortable dark with blue accent highlights
- **Typography:** System font stack for UI, monospace for data/metrics
- **Cards:** Subtle shadow, 8px radius, 1px border — no heavy 3D effects
- **Buttons:** Gradient buttons for primary actions, flat buttons for secondary
- **Icons:** Keep emoji for now (ASCII fallback-safe); evaluate icon font in future
- **Data density:** Metrics should be scannable — tabular-nums, aligned colons

### What NOT to do:
- No CSS frameworks (Tailwind, Bootstrap) — vanilla CSS only
- No CSS-in-JS — static CSS file
- No dark/light theme toggle (dark only — matches all existing screenshots and tests)
- No complex animations — subtle transitions only

---

## 6. API Changes Summary

### Phase 1-3: No API changes
All existing routes preserved with identical contracts.

### Phase 4: Optional new endpoint
- `GET /api/graph/mermaid/svg` — server-side Mermaid-to-SVG rendering (nice-to-have, not blocking)
  - Useful for export-to-image feature
  - Requires adding `@mermaid-js/mermaid-cli` as optional peer dependency
  - Gate behind `INDEX_SERVER_GRAPH_SVG_RENDER=1` env var

### Phase 5: No API changes
All enhancements are client-side UX improvements consuming existing API data.

---

## 7. Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Removing dead code breaks something** | High | Low | Dead code is self-referencing only (verified via grep). Only DashboardServer.ts line 201 has a stale reference. Phase 1 tests catch any breakage before merge. |
| **ApiRoutes split introduces regressions** | High | Medium | Contract tests snapshot all 60 route responses before split. Diff-verify after each module extraction. |
| **Mermaid rendering breaks on CSS changes** | Medium | Medium | Mermaid injects its own styles; our CSS overrides use `!important`. Test with both ELK and default layouts. Keep graph-specific CSS isolated in its own section. |
| **Graph redesign loses functionality** | High | Low | Comprehensive feature audit completed (this document). Every checkbox/selector has a documented equivalent in v2 design. |
| **SVG drilldown removal upsets users** | Low | Very Low | Feature never worked — buttons had no handlers. No user has reported it as useful because it cannot be used. |
| **Playwright tests become flaky with new UI** | Medium | Medium | Use data-testid attributes on all interactive elements. Avoid timing-dependent assertions. Use Playwright's auto-wait. |
| **Build breaks from TypeScript strict mode** | Medium | Low | Dead code removal Phase 1 reduces surface area. All remaining files already pass strict mode. |
| **Large graph performance degrades** | Medium | Medium | Keep current `maxEdges` cap. Add lazy rendering — only render when graph tab is visible. Debounce filter changes. |

---

## 8. File Layout After v2

```
src/dashboard/
  client/
    admin.html                     (refactored — no inline styles, collapsible graph)
    css/
      admin.css                    (refactored — CSS custom properties)
    js/
      admin.boot.js                (refactored)
      admin.utils.js               (refactored)
      admin.overview.js            (enhanced)
      admin.config.js              (enhanced)
      admin.sessions.js            (enhanced)
      admin.maintenance.js         (enhanced)
      admin.monitor.js             (enhanced)
      admin.instructions.js        (enhanced)
      admin.graph.js               (major rewrite — diagram-first, zoom, chip selector)
      admin.logs.js                (refactored)
      admin.performance.js         (enhanced)
      admin.instances.js           (refactored)
      admin.toast.js               (NEW — toast notification component)
  server/
    DashboardServer.ts             (cleaned — dead reference removed)
    AdminPanel.ts                  (unchanged)
    MetricsCollector.ts            (unchanged)
    WebSocketManager.ts            (unchanged)
    SessionPersistenceManager.ts   (unchanged)
    FileMetricsStorage.ts          (unchanged)
    InstanceManager.ts             (unchanged)
    KnowledgeStore.ts              (unchanged)
    routes/                        (NEW — extracted from ApiRoutes.ts)
      index.ts
      status.routes.ts
      metrics.routes.ts
      admin.routes.ts
      graph.routes.ts
      instructions.routes.ts
      knowledge.routes.ts
      alerts.routes.ts
      logs.routes.ts
      synthetic.routes.ts
    ApiRoutes.ts                   (thin orchestrator — ~100 lines)
  analytics/
    AnalyticsEngine.ts             (unchanged)
    BusinessIntelligence.ts        (unchanged)
  security/
    SecurityMonitor.ts             (unchanged)
  integration/
    APIIntegration.ts              (unchanged)
  export/
    DataExporter.ts                (unchanged)
```

**Files REMOVED (Phase 1):**
- `client/Phase3DashboardClient.ts`
- `client/Phase4DashboardClient.ts`
- `client/Phase4Demo.html`
- `client/Phase4Integration.ts`
- `client/Phase4Styles.css`
- `client/DashboardClient.ts`
- `client/DashboardStyles.ts`
- `client/DashboardTypes.ts`
- `client/js/admin.drilldown.js` (Phase 4)

**Net result: -4,473 lines removed, +~400 lines new (route modules + toast). Net reduction ~4,000 lines.**

---

## 9. Implementation Order & Dependencies

```
Phase 1 (Dead Code) ──→ Phase 2 (Route Split) ──→ Phase 3 (CSS) ──→ Phase 4 (Graph) ──→ Phase 5 (Polish)
   │                        │                        │                    │
   │ No deps                │ Depends on P1          │ Independent        │ Depends on P3
   │                        │ (clean codebase)       │ (can parallel P2)  │ (CSS tokens needed)
   └────────────────────────┴────────────────────────┴────────────────────┘
```

Phase 3 (CSS) can be worked in parallel with Phase 2 (Route Split) since they touch different file sets — CSS changes are client-only while route splitting is server-only.

---

## 10. Success Criteria

1. **Zero dead code** — no Phase3/Phase4/DashboardClient files in dist/
2. **All 60 API routes operational** — verified by contract tests
3. **Graph tab usable in <3 clicks** — load tab → auto-renders → done
4. **No SVG drilldown** — removed cleanly
5. **CSS custom properties everywhere** — zero hardcoded hex colors outside `:root`
6. **>80% test coverage** on server modules
7. **Build passes** — `npm run build && npm test` green
8. **Enterprise feel** — consistent dark theme, professional spacing, no UI glitches

---

## Appendix A: Validation Checklist (per phase)

For each phase, before marking complete:

- [ ] `npm run build` passes (Q-3 TypeScript strict)
- [ ] `npm test` passes (Q-1 unit tests)
- [ ] `npm run lint` passes (Q-4 ESLint)
- [ ] Conventional commit message used (G-3)
- [ ] No secrets in code (S-1)
- [ ] Chrome DevTools MCP snapshot taken (user req #6)
- [ ] CHANGELOG.md updated if user-facing change
