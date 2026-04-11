# Squad Decisions Registry

## 2025-07-15: Antiquity Naming Round 2

**By:** Morpheus (Lead)

### What
20 antiquity-themed candidates evaluated and ranked. **Top 3:** Tome, Lore, Glyph.

**Blocked Names:**
- **relic** — Trademark conflict (New Relic)
- **canon** — Trademark conflict (Canon Inc)
- **creed** — IP conflict (Assassin's Creed)
- **athena** — Trademark conflict (AWS Athena)
- **oracle** — Trademark conflict (Oracle Corp)

**Pattern Override:** Tank's SS-abbreviation pattern overruled for s-starting names (saga, sigil cleared).

### Why
Full 6-agent cross-lens evaluation with conflict resolution:

1. **Trinity** (Technical) — npm/CLI ergonomics assessment
2. **Oracle** (Appeal) — Developer memorability & discoverability
3. **Briggs** (Legal) — Trademark clearance audit (35 candidates scanned, 5 blocked, 21 clear)
4. **Mouse** (Visual) — Brand/logo fit evaluation
5. **Tank** (Stress-Test) — Homophones, abbreviations, typos (7 cleanest identified)
6. **Morpheus** (Synthesis) — Ranked full 20-candidate table, resolved 6 cross-agent conflicts

### Ranking

| # | Name | Score | Notes |
|---|------|-------|-------|
| 1 | **Tome** | 8.50/10 | Balanced safety, strong legal clearance, excellent visual fit |
| 2 | **Lore** | 8.45/10 | Highest developer appeal (Oracle: 9.5/10), semantic excellence |
| 3 | **Glyph** | 8.25/10 | Top visual brand candidate, clean legal profile |

---

## 2025-07-15: User Directive — Antiquity Theme Focus

**By:** Jason Gilbertson (via Copilot)

### What
Naming round 2: exactly 20 antiquity-themed name options. No pirate names. Focus on ancient civilizations, archaeology, ancient texts/artifacts, classical world (Egyptian, Greek, Roman, Mesopotamian). Short names preferred (4-8 chars). Must work as `@jagilber-org/server-{name}`.

### Why
User request — narrowing theme from broad pirate/archaeology to strict antiquity.

---

## 2026-02-26: Import Handler Supports Directory and File Path Inputs

**By:** Trinity (Backend)

### What
Extended `instructions_import` handler to accept three input modes:
1. `entries` as inline array (existing behavior, preserved)
2. `entries` as string file path → read + parse as JSON array
3. `source` as directory path → scan for `.json` files (excluding `_`-prefixed), read each, collect entries

### Why
Feedback `fa6fca24eb925ad5` — bulk import via `action=import` failed for both directory paths and file paths, forcing users to make N individual `add` calls. The handler only accepted inline arrays despite callers reasonably passing paths.

### Schema Impact
- `instructions_import` INPUT_SCHEMA: `entries` now accepts `oneOf: [array, string]`; new optional `source` param; `entries` no longer strictly required when `source` is provided
- `instructions_dispatch` schema: `entries` updated to accept string; `source` param added
- Zod layer: no changes needed (import doesn't have a Zod schema yet — progressive coverage)

### Constitution Compliance
path.resolve() for all paths (S-4), logAudit already present (A-5), registerHandler pattern preserved (Q-5), IndexContext used via existing flow (A-3).

---

## 2026-02-26: Phase 3 RED Test Approach

**Author:** Tank (Tester)  
**Status:** Implemented

### Context
Phase 3 (CSS/UX Modernization) needs RED tests before implementation begins allowing TDD workflow.

### Decision
Used pure file-system structural tests (read CSS/HTML files, parse with regex) instead of browser-based tests. This avoids spinning up Playwright or a real browser for what are essentially linting checks.

### Key Thresholds
- **Inline styles:** ≤10 allowed (currently 176). Allows dynamic toggles like `display:none`.
- **Hex colors outside :root:** 0 allowed (currently 99). Forces adoption of CSS variables.
- **Graph gradient buttons:** 0 allowed (currently 9). Must use `.btn-*` CSS classes.

### Tradeoffs
- These tests don't verify runtime rendering — they verify code structure.
- The hex-color check strips CSS comments and attribute selectors (like `[style*='fill:#fff']`) to avoid false positives from Mermaid overrides.
- If someone adds a 3rd-party CSS embed with hex colors, the test would flag it. That's intentional.

---

## 2026-03-22: Squad Reviewed and Hardened for Full Lifecycle Work

**By:** coordinator

### What Changed
Squad configuration was reviewed and updated for full lifecycle readiness on the MCP Index Server repo.

### Fixes
- `team.md` repo path corrected: `jagilber-org/index-server-dev` → `jagilber-dev/mcp-index-server`
- `mouse/history.md` repo path corrected to match
- All agent models updated: `claude-sonnet-4.5` → `claude-sonnet-4.6` (Trinity, Tank, Oracle, Scribe, Mouse, Ralph)
- Casting registry completed: Scribe and Ralph added (were missing)
- Ralph charter and history created (files were absent despite team.md listing the agent)

### Skills Added
Four project-specific skills added to replace the only existing skill (`squad-conventions`, which documents the Squad CLI tool rather than this project):

1. **mcp-handler-patterns** — registerHandler() pattern, tool registry, audit logging, mutation gating
2. **Index-context-patterns** — IndexContext usage, schema validation before write
3. **testing-patterns** — vitest TDD, mocking patterns, conformance tests, coverage targets
4. **typescript-mcp-conventions** — strict mode, .js imports, runtimeConfig, conventional commits

### Why
Team had no project-specific skills — agents working on this codebase had no documented reference for the key patterns (A-1 through A-5, Q-1 through Q-8). Skills close this gap and enable consistent implementation across all agents.

---

## 2026-03-26: Cross-Platform (Linux/macOS) Support Effort Assessment

**By:** coordinator

### Context
**Date:** 2026-03-26 | **Requested by:** User | **Assessed by:** Trinity (Backend), Tank (Testing), Oracle (DevRel)

### Good News: Core App Is Already Cross-Platform ✅
- All TypeScript source uses `path.join()`/`path.resolve()` properly
- Line endings handled correctly (`\r?\n` patterns in canonical.ts, thin-client.ts)
- No hardcoded Windows paths in production code
- Docker (Alpine Linux) already works
- Dashboard/Express binds to `127.0.0.1` (platform-agnostic)
- 99% of tests spawn `node`, not shell-specific tools

### The Gaps: Dev Tooling Is PowerShell-Centric 🔴

| Issue | Severity | Impact |
|-------|----------|--------|
| `npm test` blocked — `pretest` invokes `pwsh` | 🔴 Critical | Linux/macOS devs can't run tests |
| Release scripts (`bump-version.ps1`) PowerShell-only | 🔴 Critical | Can't release from non-Windows |
| 34 PowerShell scripts in `scripts/` with 0 bash equivalents | 🟡 High | Ecosystem fragmented |
| Git hooks shell out to `.ps1` files | 🟡 Medium | Requires PowerShell Core on Unix |
| CI only runs on Ubuntu — no macOS/Windows matrix | 🟡 Medium | Cross-platform not validated |
| Playwright snapshots are win32-only | 🟡 Medium | Visual tests fail on other OS |
| 1 test (`handshakePwshIsolation`) spawns `pwsh` directly | 🟠 Low | Isolated, can be skipped |
| Leader/follower socket behavior flagged in spec 003 | 🟡 Medium | Needs platform-specific testing |

### Package.json Blockers (6 scripts hardcode `pwsh`)
```
pretest: pwsh scripts/pretest-build-or-skip.ps1
scan:security: pwsh scripts/security-scan.ps1
release:patch/minor/major: pwsh scripts/bump-version.ps1
build:verify: pwsh scripts/build.ps1
```

### Estimated Effort: ~3-4 days (1 developer)

| Phase | Work | Effort |
|-------|------|--------|
| 1. Unblock npm test | Port `pretest-build-or-skip.ps1` → `.mjs`, update package.json | ~0.5 day |
| 2. Port release scripts | Port `bump-version.ps1` → `.mjs`, update npm scripts | ~0.5 day |
| 3. Git hooks | Create Node.js hook shims as fallback when `pwsh` missing | ~0.5 day |
| 4. CI multi-OS matrix | Add `macos-latest` + `windows-latest` to CI workflows | ~0.5 day |
| 5. Playwright snapshots | Generate Linux/macOS baselines, platform-aware naming | ~0.5 day |
| 6. Guard and document | Skip `pwsh` tests on non-Windows, update CONTRIBUTING.md | ~0.5 day |
| Buffer for surprises | Edge cases, CI debugging | ~0.5-1 day |

### Scripts Inventory
- **34 PowerShell-only (.ps1)** — deployment, monitoring, release, hooks, build
- **58 Node.js cross-platform (.js/.mjs/.cjs)** — perf, flake, coverage, validation, generation
- **0 Shell scripts (.sh/.bash)** — GAP

### Recommendation
Port the 6 critical `package.json` npm scripts from PowerShell to Node.js (~200 lines), add OS matrix to CI, and document. No architectural changes needed — the hard part (cross-platform runtime) is already done.
