# Morpheus — History

## Project Context
- **Project:** MCP Index Server v1.8.1 — enterprise instruction indexing for AI governance
- **Stack:** TypeScript (strict, CommonJS), Node.js ≥20, MCP SDK, vitest, Express + WebSocket
- **User:** Jason Gilbertson
- **Tools:** 50 registered MCP tools (core=7, extended=14, admin=29)
- **Constitution:** constitution.json with 5 articles (quality, security, architecture, governance, publishing)

## Learnings
<!-- Append architecture decisions, patterns, governance observations below -->
- Architecture plan created for Dashboard v2 overhaul (2026-02-26). Key decisions: 5-phase iterative breakdown, 4,435 lines dead Phase3/Phase4 code removal, SVG drilldown removal (never worked — no handlers wired), graph tab redesign to diagram-first UX with collapsible controls, ApiRoutes.ts split into 10 route modules. All 60 API routes preserved. Plan at `.squad/decisions/inbox/morpheus-dashboard-v2-plan.md`.

## Sessions

### 2026-03-25T15:30:22.053Z
## Session: Enterprise Dual-Publish Setup (2026-03-25)
Branch: feat/enterprise-dual-publish
PLAN.md created at repo root (gitignored) with 10 phases, ~67 tasks.
Team assignments: Morpheus (constitution+CI), Trinity (cleanup+publish+pkg), Tank (TDD+playwright+e2e), Oracle (docs), Mouse (frontend e2e support), Scribe (logging).
Constitution expansion needed: Testing TS-1 to TS-12, PB-6, Code Quality, Build & Deploy, Data Integrity, PII & Pre-Commit.
MCP knowledge applied: dual-repo-publishing-spec, speckit-constitution-template, mcp-server-testing-patterns-2025, playwright-web-testing-workflow.
Key rules: TDD non-negotiable, Playwright mandatory, only push to origin (private), merge to main for review.

## Updates

### 2026-03-26T17:20:44.792Z
### 2026-03-26: v1.12.1 Release
- Server v1.12.1 released (VSIX extension v1.6.4)
- SLSA provenance attestation added to build-vsix.yml (continue-on-error for private repos — requires billing upgrade or public repo for full attestation)
- Local branch cleanup: feat/enterprise-dual-publish deleted (merged), stash dropped
- CI note: GitHub Actions Node.js 20 deprecation warning — actions need updating to Node.js 24 before June 2026
- Version gap: no tags between v1.11.2 and v1.12.1 (server version bumped in package.json without intermediate releases)
