# Index Constitution

> Index Server — Enterprise instruction indexing platform for AI assistant governance. Aligned to the layered hook security template constitution v2.8.0.

**Version**: 2.9.0  
**Ratified**: 2026-02-16

## Core Principles

### I. Template Governance And Change Control

| ID | Rule | Severity |
|----|------|----------|
| TG-1 | Template changes MUST land as versioned deltas rather than wholesale repo overwrites. | error |
| TG-2 | When template-managed behavior changes, the manifest, adoption markers, dependent guidance, and helper scripts MUST be updated in the same change. | error |
| TG-3 | Repositories aligned to this template SHOULD record their adopted version only after the intended delta is actually complete. | warning |

### II. Git Workflow, Branch Lifecycle, And Merge Safety

| ID | Rule | Severity |
|----|------|----------|
| GW-1 | Substantive changes MUST use short-lived topic branches and reviewed pull requests into the repository's protected default branch or documented equivalent integration branch. | error |
| GW-2 | Default pull request merges MUST preserve reviewable branch ancestry and cleanup safety; squash merging is prohibited unless a repository documents that policy or the user explicitly requests it for the specific merge. | error |
| GW-3 | Merged topic branches SHOULD be cleaned up locally and remotely after merge when safe, and agents SHOULD synchronize the default branch before deleting local work branches. | warning |

### III. Agent Scope, Evidence, And Change Discipline

| ID | Rule | Severity |
|----|------|----------|
| AG-1 | Agents MUST prefer the narrowest local hypothesis, the smallest testable edit, and the nearest controlling code or document surface before expanding scope. | error |
| AG-2 | Agents MUST not invent requirements, widen scope, or add speculative abstractions when the current request or local evidence does not justify them. | error |
| AG-3 | When ambiguity materially affects security, scope, architecture, or validation strategy, agents SHOULD surface the ambiguity explicitly instead of guessing. | warning |
| AG-4 | Agent-authored commits and decision records MUST include structured attestation metadata identifying the agent, its trust level, the authorizing human, and the guiding instruction hash. | error |

### IV. Security And Secret Hygiene

| ID | Rule | Severity |
|----|------|----------|
| SH-1 | pre-commit MUST remain the single Git hook orchestrator unless a repository explicitly replaces it and documents the equivalent enforcement model. | error |
| SH-2 | The layered hook model MUST preserve forbidden-file blocking, curated PII scanning, live env-value leak scanning, prompt injection scanning, secret scanning, and protected-remote enforcement. | error |
| SH-3 | Repositories MUST not commit real secrets, real PII, or unaudited secret allowlists, and CI MUST replay the same security policy as local development. | error |
| SH-4 | File-system operations influenced by user input MUST validate that resolved paths stay within an intended base directory; unchecked path traversal is prohibited. | error |
| SH-5 | Administrative servers, dashboards, and control-plane endpoints MUST default to loopback-only binding unless broader exposure is an explicit documented opt-in. | error |
| SH-6 | Production code MUST keep TLS certificate verification enabled; self-signed or private-CA scenarios MUST use explicit trust configuration rather than disabling verification. | error |
| SH-7 | API keys, admin tokens, and similar bearer credentials MUST be accepted through Authorization or other non-URL secret-bearing headers; query-parameter authentication is prohibited. | error |
| SH-8 | Browser-facing applications SHOULD enforce Content-Security-Policy defaults that avoid unsafe-inline and unsafe-eval; any exception should be narrow, documented, and time-bounded. | warning |
| SH-9 | Debug, trace, synthetic, or diagnostic behaviors that expose internal detail or change execution SHOULD be disabled by default in production and gated by configuration or environment rather than request parameters alone. | warning |
| SH-10 | Committed content MUST be scanned for prompt injection patterns — adversarial instructions embedded in comments, documentation, or configuration that target AI coding agents. | error |
| S-3 | Mutation tools are enabled by default but still require bootstrap gating, and operators MUST use INDEX_SERVER_MUTATION=0 when they need an explicit read-only runtime. | error |
| S-4 | All environment configuration must flow through src/config/runtimeConfig.ts. | error |

### V. Architecture Simplicity And Enterprise Change Safety

| ID | Rule | Severity |
|----|------|----------|
| AR-1 | Designs MUST default to the simplest structure that satisfies the current requirement set and documented enterprise constraints. | error |
| AR-2 | Changes that affect compatibility, operational workflows, or generated artifacts SHOULD include explicit migration or adoption notes. | warning |
| A-1 | Handler registration uses side-effect imports in src/services/toolHandlers.ts. | error |
| A-2 | Tool registry (INPUT_SCHEMAS, STABLE, MUTATION sets) must be updated for new tools. | error |
| A-3 | IndexContext is the single source of truth for instruction state (writeEntry + ensureLoaded). | error |
| A-4 | Schema version must be tracked via src/versioning/schemaVersion.ts. | warning |
| A-5 | Audit logging (logAudit) is required for all mutation operations. | error |
| A-6 | Instruction body size must be enforced at write-time: index_add and index_import must reject bodies exceeding bodyWarnLength with actionable split/cross-link guidance. | error |
| A-7 | Canonical seeds in seedBootstrap.ts must contain only generalized, public-safe content about the index server, Index operations, and bootstrapping — no environment-specific, org-specific, or custom configuration data. | error |

### VI. Observability, Structured Logging, And Diagnostics

| ID | Rule | Severity |
|----|------|----------|
| OB-1 | Repositories SHOULD standardize on structured NDJSON or JSONL logging for machine-parsable diagnostics unless an existing platform logging standard already provides equivalent structure. | warning |
| OB-2 | Application and service code SHOULD provide enter and exit tracing with relevant values for operationally meaningful functions, workflows, and boundaries, and MUST document any deliberate exclusions for hot paths or noise-sensitive loops. | warning |
| OB-3 | Exceptions, failed operations, and unexpected states MUST be logged with enough stack or call-site context to support direct troubleshooting when the runtime can provide it. | error |
| OB-4 | Structured logging defaults SHOULD include stable fields for timestamp, severity, message, and optional execution context such as module, request, process, or port identifiers. | warning |
| OB-5 | Error handlers, catch blocks, and fallback paths MUST log at a severity visible under the application's default log level, not at DEBUG or TRACE where default configuration silently drops the message. | error |
| OB-6 | Repeating per-record diagnostic logs MUST be deduplicated per process, and CI MUST scan collected logs for repeat-spam, stack-traced WARNs, and known chronic-issue patterns. | error |

### VII. Testing And Validation Strategy

| ID | Rule | Severity |
|----|------|----------|
| TS-1 | Changes MUST use the narrowest falsifiable validation first, then broaden only as the changed surface requires. | error |
| TS-2 | Repositories SHOULD maintain layered testing that matches their runtime surface: unit for deterministic logic, integration or contract for boundaries, functional or scenario tests for workflows, and end-to-end browser tests for critical UI journeys. | warning |
| TS-3 | When a repository includes a browser UI, Playwright SHOULD be the default E2E framework unless the repo already has a documented stronger standard. | warning |
| TS-4 | Test environments MUST match production runtime wrappers, modes, and framework-level strictness settings so that tests exercise the same runtime behavior users experience. | error |
| TS-5 | All tests MUST pass before commit. | error |
| TS-6 | New features MUST include test coverage. | error |
| TS-7 | Functional tests MUST validate full pipeline round-trips. | error |
| TS-8 | TDD red/green is NON-NEGOTIABLE: tests MUST be written and verified FAILING before implementation code; failing test first, fix second (red-green-refactor). | error |
| TS-9 | Every bug fix MUST start with a failing regression test: write a test that reproduces the failure, then fix and verify pass. | error |
| TS-10 | Tests MUST exercise the REAL production code; toy reimplementations and stub copies of the code under test are prohibited. | error |
| TS-11 | Playwright e2e tests MUST cover dashboard UI, instruction CRUD lifecycle, and search functionality. | error |
| TS-12 | Bug-prone handlers and complex code paths MUST have >= 5 test cases covering normal, edge, error, boundary, and concurrent scenarios. | error |

### VIII. Documentation, Traceability, And Consistency

| ID | Rule | Severity |
|----|------|----------|
| DC-1 | Behavioral changes MUST update the affected documentation, setup guidance, and examples in the same change when those materials are part of the canonical template contract. | error |
| DC-2 | Non-obvious constraints, exceptions, and design choices SHOULD carry explicit rationale rather than relying on tribal knowledge. | warning |
| DC-3 | Repositories intended for reuse, publication, or external distribution MUST declare an explicit license or explicitly document proprietary or internal-only status. | error |
| G-6 | Documentation filenames use lowercase_underscore convention (e.g. project_prd.md, mcp_configuration.md). | warning |

### IX. Knowledge Retrieval And Promotion

| ID | Rule | Severity |
|----|------|----------|
| KR-1 | Agents SHOULD search nearby code and docs first, then repo-local instructions, then index-server, and only then external sources. | warning |
| KR-2 | Stable learnings SHOULD begin in local instructions or repo memory and be promoted only after validation proves they are reusable. | warning |
| KR-3 | The index-server primer, promotion map, and Copilot instructions MUST stay aligned when the template knowledge model changes. | error |

### X. Optional Integration Profiles

| ID | Rule | Severity |
|----|------|----------|
| IP-1 | A base .github/copilot-instructions.md file MUST exist and teach the retrieval order, constitution authority, and validation expectations for the template. | error |
| IP-2 | .specify scaffolding is optional and MUST not impose mandatory runtime or toolchain dependencies on small tasks. | warning |
| IP-3 | squad and other optional profiles MAY complement repository workflows, but they do not replace repo-local instructions, constitution rules, or promoted knowledge boundaries. | warning |
| IP-4 | IaC scaffolding is optional and MUST NOT impose a specific IaC tool as a mandatory dependency. Repos using IaC MUST keep state files out of version control and MUST scan IaC definitions with at least one static analysis tool. | warning |
| IP-5 | Repositories with application or library code SHOULD configure GitHub dependency graph visibility, Dependabot, and at least one dependency audit mechanism for their primary languages, and SHOULD tune SAST rulesets for the languages present. | warning |

### 11. CI, Release, And Deployment Discipline

| ID | Rule | Severity |
|----|------|----------|
| CD-1 | CI MUST run on pull requests and MUST validate the same required security and quality policy as local development, using reproducible install and build steps when the stack supports them. | error |
| CD-2 | Repositories with release, publish, or deployment flows MUST release from clean trees and green CI using tagged, reviewable commits or another documented immutable version marker. | error |
| CD-3 | Deployments SHOULD emit machine-readable manifests or retained artifacts and SHOULD run post-deploy smoke, integrity, or readiness checks before they are treated as successful. | warning |
| CD-4 | Repositories MAY use specialized scheduled or domain-specific workflows for security, governance, performance, or UI drift, but those workflows do not replace required pull request gates. | warning |
| PB-1 | All active repos MUST follow the dual-repo pattern: private dev repo for all development, public pub repo as read-only mirror. | error |
| PB-2 | Public publication repos MUST NOT receive direct pushes; all updates MUST flow through the publish script (scripts/publish-direct-to-remote.cjs) from the dev repo. | error |
| PB-3 | Internal artifacts (.specify/, specs/, issue templates, state/, logs/) MUST be excluded from publication via .publish-exclude. | error |
| PB-6 | Dev repos MUST have a pre-push hook that queries GitHub API for repo visibility and blocks pushes to public remotes; bypass requires a SHA-256 token computed by the publish scripts (PUBLISH_OVERRIDE=1 is NOT sufficient). | error |

### 12. Validation, Testing Outputs, And Determinism

| ID | Rule | Severity |
|----|------|----------|
| VA-1 | Template changes affecting hooks, instructions, constitution, templates, or bootstrap files MUST pass focused validation before broader checks. | error |
| VA-2 | constitution.md MUST be regenerated from constitution.json before commit whenever the constitution source changes. | error |
| VA-3 | Helper scripts and generated outputs SHOULD be deterministic, readable, and specific enough that failures do not require manual guesswork. | warning |

### 13. Code Quality

| ID | Rule | Severity |
|----|------|----------|
| CQ-1 | Source files SHOULD target <=600 lines; MUST NOT exceed 1000 (template literals exempt). | warning |
| CQ-2 | Each module MUST have a single primary responsibility; god-modules that mix unrelated concerns are prohibited. | error |
| CQ-3 | Source code MUST follow the project declared layered architecture; cross-layer imports MUST flow downward only. | error |
| CQ-4 | Circular dependencies are prohibited; module dependency graphs MUST be acyclic. | error |
| CQ-5 | Dead code MUST be removed before commit; unused imports, variables, and unreachable branches are not allowed. | warning |
| CQ-6 | Error handling MUST be explicit; swallowed exceptions (empty catch blocks) are prohibited — errors MUST be logged, re-thrown, or handled with documented rationale. | error |
| CQ-7 | Public APIs MUST have JSDoc documentation including @param, @returns, and @throws where applicable. | warning |

### 14. Data Integrity & Persistence

| ID | Rule | Severity |
|----|------|----------|
| DI-1 | All stateful data MUST persist to disk; startup MUST auto-restore. | error |
| DI-2 | Corrupted or empty files MUST result in safe empty state, not crashes. | error |
| DI-3 | Schema changes to persisted files MUST include migration logic or be backwards-compatible. | warning |
| DI-4 | Write paths MUST mirror read paths for normalization, migration, and validation. Any record passing through a writer MUST run the same migration and validation sequence the loader runs at read time so that round-trips are symmetric. | error |

## Thresholds

| Metric | Value |
|--------|-------|
| minTestCount | 1 |
| maxTestDurationMs | 5000 |
| minCoveragePercent | 80 |
| maxLintErrors | 0 |

## Key References

- **templateManifest**: `template-manifest.json`
- **copilotInstructions**: `.github/copilot-instructions.md`
- **instructionsReadme**: `.instructions/README.md`
- **promotionMap**: `.specify/config/promotion-map.json`
- **constitutionSyncScript**: `scripts/build/sync-constitution.ps1`
- **architecture**: `docs/architecture.md`
- **prd**: `docs/project_prd.md`
- **contributing**: `CONTRIBUTING.md`
- **tools**: `docs/tools.md`
- **changelog**: `CHANGELOG.md`

---
*Generated by sync-constitution.cjs from constitution.json v2.9.0*
