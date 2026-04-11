# Mouse — History

## Context
- **Project**: MCP Index Server — Enterprise instruction indexing platform for AI assistant governance
- **Stack**: TypeScript (strict, CommonJS), Node.js ≥20, Express + WebSocket dashboard
- **User**: Jason Gilbertson
- **Repo**: <root>\mcp-index-server
- **Branch**: feature/web-page

## Learnings

### Day 1 — Dashboard Audit (2026-02-26)
- Current dashboard: single `admin.html` (~2000 lines) + 13 JS modules + 1 CSS file
- 7 tabs: Overview, Config, Sessions, Maintenance, Monitoring, Instructions, Graph
- Legacy dead weight: Phase3/Phase4 client files (~2,800 lines, unused)
- Graph tab has clunky multi-select selectors and broken SVG drilldown
- CSS uses dark theme with CSS custom properties (good foundation)
- Server backend: DashboardServer.ts, ApiRoutes.ts (2,210 lines), AdminPanel.ts
- Dashboard served at `/admin` with WebSocket at `/ws`
- API routes at `/api/*` — comprehensive REST endpoints already exist
- User wants: enterprise feel, improved graph, working SVG or remove it, iterative approach
