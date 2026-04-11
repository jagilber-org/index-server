# Index Constitution

> Index Server — Enterprise instruction indexing platform for AI assistant governance

**Version**: 2.0.0  
**Ratified**: 2026-02-16

## Core Principles

### I. Code Quality & Testing

| ID | Rule | Severity |
|----|------|----------|
| Q-1 | All exported functions and handlers must have unit tests | error |
| Q-2 | Test coverage must exceed 80% for src/services/ and src/server/ | warning |
| Q-3 | TypeScript strict mode must be enabled (tsc --noEmit must pass) | error |
| Q-4 | ESLint must report zero errors (warnings allowed) | error |
| Q-5 | All MCP tool handlers must follow the registerHandler() pattern in src/server/registry | error |
| Q-6 | Vitest tests must complete within the configured timeout (5s default per test) | warning |
| Q-7 | Dispatcher action additions must include schema-contract tests verifying dispatch INPUT_SCHEMA properties are a superset of downstream handler schemas | error |
| Q-8 | Mutation actions routed through index_dispatch must have agent-perspective tests that construct params using only the dispatch schema (no pre-cooked wrappers or direct handler calls) | error |

### II. Security & Secrets

| ID | Rule | Severity |
|----|------|----------|
| S-1 | No secrets, API keys, or credentials in source code | error |
| S-2 | Pre-commit hooks must be installed and active (scripts/pre-commit.ps1) | error |
| S-3 | Mutation tools require INDEX_SERVER_MUTATION=1 and bootstrap gating | error |
| S-4 | All environment configuration must flow through src/config/runtimeConfig.ts | error |

### III. Architecture & Patterns

| ID | Rule | Severity |
|----|------|----------|
| A-1 | Handler registration uses side-effect imports in src/services/toolHandlers.ts | error |
| A-2 | Tool registry (INPUT_SCHEMAS, STABLE, MUTATION sets) must be updated for new tools | error |
| A-3 | IndexContext is the single source of truth for instruction state (writeEntry + ensureLoaded) | error |
| A-4 | Schema version must be tracked via src/versioning/schemaVersion.ts | warning |
| A-5 | Audit logging (logAudit) is required for all mutation operations | error |
| A-6 | Instruction body size must be enforced at write-time: index_add and index_import must reject bodies exceeding bodyMaxLength with actionable split/cross-link guidance | error |
| A-7 | Canonical seeds in seedBootstrap.ts must contain only generalized, public-safe content about the index server, Index operations, and bootstrapping — no environment-specific, org-specific, or custom configuration data | error |

### IV. Governance & Process

| ID | Rule | Severity |
|----|------|----------|
| G-1 | All features must begin as specifications in specs/ | warning |
| G-2 | Version bumps follow semver and require CHANGELOG.md updates | error |
| G-3 | Conventional commits required (feat:, fix:, test:, refactor:, docs:) | error |
| G-4 | No automatic pushes — explicit user approval required | error |
| G-5 | Instruction Index changes must pass governance hash validation | warning |
| G-6 | Documentation filenames use lowercase_underscore convention (e.g. project_prd.md, mcp_configuration.md) | warning |

### V. Dual-Repo Publishing

| ID | Rule | Severity |
|----|------|----------|
| PB-1 | All active repos MUST follow the dual-repo pattern: private dev repo for all development, public pub repo as read-only mirror | error |
| PB-2 | Public publication repos MUST NOT receive direct pushes; all updates MUST flow through the publish script (scripts/publish.cjs) from the dev repo | error |
| PB-3 | Internal artifacts (.specify/, specs/, issue templates, state/, logs/) MUST be excluded from publication via .publish-exclude | error |
| PB-4 | Publishes MUST be release-aligned; the publish script MUST be used (no ad-hoc file copies or direct pushes) | error |
| PB-5 | Public repos MUST have issues, wiki, and projects disabled; CONTRIBUTING.md MUST explain the contribution policy | error |
| PB-6 | Dev repos MUST have a pre-push hook that queries GitHub API for repo visibility and blocks pushes to public remotes; bypass requires a SHA-256 token computed by the publish scripts (PUBLISH_OVERRIDE=1 is NOT sufficient) | error |

### VI. Test Requirements

| ID | Rule | Severity |
|----|------|----------|
| TS-1 | All tests MUST pass before commit | error |
| TS-2 | New features MUST include test coverage | error |
| TS-3 | Test count MUST NOT decrease below minTestCount threshold | error |
| TS-4 | Functional tests MUST validate full pipeline round-trips | error |
| TS-5 | Test coverage MUST be tracked and maintained above project threshold | warning |
| TS-6 | Tests MUST be implemented, verified passing, and results stored before commit | error |
| TS-7 | TDD red/green is NON-NEGOTIABLE: tests MUST be written and verified FAILING before implementation code; failing test first, fix second (red-green-refactor) | error |
| TS-8 | Every bug fix MUST start with a failing regression test: write a test that reproduces the failure, then fix and verify pass; no fix without a red test first | error |
| TS-9 | Tests MUST exercise the REAL production code; toy reimplementations and stub copies of the code under test are prohibited; export internal functions if needed for testability | error |
| TS-10 | Server code MUST have tests; dependencies (I/O, network, external services) MUST be mocked but the code under test itself MUST NOT be mocked or replaced | error |
| TS-11 | Playwright e2e tests MUST cover dashboard UI, instruction CRUD lifecycle, and search functionality | error |
| TS-12 | Bug-prone handlers and complex code paths MUST have >= 5 test cases covering normal, edge, error, boundary, and concurrent scenarios | error |

### VII. Code Quality

| ID | Rule | Severity |
|----|------|----------|
| CQ-1 | Source files SHOULD target <=600 lines; MUST NOT exceed 1000 (template literals exempt) | warning |
| CQ-2 | Each module MUST have a single primary responsibility; god-modules that mix unrelated concerns are prohibited | error |
| CQ-3 | Source code MUST follow the project declared layered architecture; cross-layer imports MUST flow downward only | error |
| CQ-4 | Circular dependencies are prohibited; module dependency graphs MUST be acyclic | error |
| CQ-5 | Dead code MUST be removed before commit; unused imports, variables, and unreachable branches are not allowed | warning |
| CQ-6 | Error handling MUST be explicit; swallowed exceptions (empty catch blocks) are prohibited — errors MUST be logged, re-thrown, or handled with documented rationale | error |
| CQ-7 | Public APIs MUST have JSDoc documentation including @param, @returns, and @throws where applicable | warning |

### VIII. Build & Deploy

| ID | Rule | Severity |
|----|------|----------|
| BD-1 | Build MUST succeed with zero errors before commit | error |
| BD-2 | No hardcoded secrets or credentials in source | error |
| BD-3 | Dependencies MUST be pinned to exact versions in lock files | error |

### IX. Data Integrity & Persistence

| ID | Rule | Severity |
|----|------|----------|
| DI-1 | All stateful data MUST persist to disk; startup MUST auto-restore | error |
| DI-2 | Corrupted or empty files MUST result in safe empty state, not crashes | error |
| DI-3 | Schema changes to persisted files MUST include migration logic or be backwards-compatible | warning |

### X. PII & Pre-Commit Enforcement

| ID | Rule | Severity |
|----|------|----------|
| PH-1 | PII pre-commit hooks MUST be installed and active; .pre-commit-config.yaml with detect-secrets and detect-private-key MUST be present | error |
| PH-2 | .secrets.baseline MUST be committed and kept current; new secrets MUST be audited before allowlisting | error |
| PH-3 | Committed source, data files, and test fixtures MUST NOT contain real PII; use synthetic data for tests | error |

## Thresholds

| Metric | Value |
|--------|-------|
| minTestCount | 1 |
| maxTestDurationMs | 5000 |
| minCoveragePercent | 80 |
| maxLintErrors | 0 |

## Key References

- **architecture**: `docs/architecture.md`
- **prd**: `docs/project_prd.md`
- **contributing**: `CONTRIBUTING.md`
- **tools**: `docs/tools.md`
- **changelog**: `CHANGELOG.md`

---
*Generated by sync-constitution.cjs from constitution.json v2.0.0*
