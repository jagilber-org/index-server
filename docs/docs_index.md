# Documentation Index

This index distinguishes between **active** project documentation and **archived historical artifacts** moved under `docs/archive/`.

## Active (Authoritative) Documents

| Category | File | Purpose |
|----------|------|---------|
| Requirements | `project_prd.md` | Canonical product & governance requirements |
| Constitution | `../memory/constitution.md` | Instruction & knowledge governance (spec-kit adapted) |
| Specs (P1) | `../specs/000-bootstrapper.md` | Bootstrapper minimal dual-layer model |
| Specs (P1) | `../specs/001-knowledge-index-lifecycle.md` | Lifecycle expansion & promotion gates |
| API / Tools | `TOOLS.md` | MCP tool Index & schemas |
| Configuration | `mcp_configuration.md` | MCP multi-environment setup patterns |
| Server Runtime | `CONFIGURATION.md` | Flags, env vars, CLI switches |
| Content Strategy | `CONTENT-GUIDANCE.md` | Instruction curation & promotion workflow |
| Prompts | `prompt_optimization.md` | Prompt handling & optimization guidance |
| Architecture | `ARCHITECTURE.md` | System & component design |
| Architecture (Interactive) | `../scripts/diagram-viewer.html` | Full-page pan/zoom Mermaid diagrams (exportable) |
| Manifest | `MANIFEST.md` | Index manifest lifecycle, invariants, fastload roadmap |
| Knowledge API | `KNOWLEDGE-API-SPEC.md` | Knowledge endpoint API specification |
| Runtime Config | `RUNTIME-CONFIG-MAPPING.md` | Runtime configuration mapping reference |
| Security | `SECURITY.md` | Security controls & compliance posture |
| Security Guards | `SECURITY-GUARDS.md` | Pre-commit & security mechanisms |
| Dashboard | `DASHBOARD.md` | Admin UI usage & drift maintenance |
| Planning | `../ACTIVE-PLAN.md` | Current sprint priorities, feedback-driven tasks & compliance reviews |
| Testing | `TESTING-STRATEGY.md` | Test tiers, quarantine & drift policies |
| Testing | `TESTING.md` | Test artifact management guide |
| Testing | [Stress Testing](stress-testing.md) | Stress test scripts, parallel mode, CI integration, troubleshooting |
| Runtime Diagnostics | `RUNTIME-DIAGNOSTICS.md` | Error & signal instrumentation |
| Versioning | `VERSIONING.md` | Release semantics & governance |
| Publishing | [Publishing](publishing.md) | Dual-repo publish workflow, script reference, safety guarantees |
| Migration | `MIGRATION.md` | Upgrade & breaking change handling |
| Index | `Index-NORMALIZATION.md` | Ingestion normalization spec |
| Index | `Index-QUALITY-GATES.md` | Enforced quality gates |
| Metrics | `METRICS-FILE-STORAGE.md` | Metrics file storage configuration |
| Governance | `archive/agent_execution_directive.md` | Governance rule for agent operations (archived) |
| Tracing | `TRACING.md` | Env flag matrix for tracing |

| PowerShell MCP | `POWERSHELL-MCP-GUIDE.md` | PowerShell server integration guide |
| GPT-5 MCP | `GPT5-MCP-CONNECTION-GUIDE.md` | GPT-5 connection quick-start |
| GPT-5 Testing | `GPT5-MCP-TESTING-KB.md` | Testing tools reference |
| VS Code MCP | `vscode_mcp.md` | VS Code integration guide |
| Agent Graph | `AGENT-GRAPH-INSTRUCTIONS.md` | Operational playbook for agents leveraging graph_export |
| Process | `FEEDBACK-DEFECT-LIFECYCLE.md` | Feedback-to-fix lifecycle process |
| Graph | `GRAPH.md` | Graph subsystem documentation |
| Deployment | `DEPLOYMENT.md` | Deployment & troubleshooting guide |
| Client Scripts | `CLIENT-SCRIPTS.md` | REST client scripts for agents without MCP access |

### Recent Governance & Runtime Updates (1.4.x)

1.4.x adds:

* Manifest subsystem central helper + counters; disable flag `INDEX_SERVER_MANIFEST_WRITE=0`.
* Opportunistic in-memory materialization (race-free add visibility).
* PRD 1.4.2 ratified manifest & materialization requirements (see `project_prd.md`).
* Continued governance stability (SemVer create enforcement & overwrite hydration retained from 1.3.1).

### Specification Model (Spec-Kit Integration)

Two sequential P1 specifications are now active under the adapted spec-kit model:

1. `000-bootstrapper.md` (category: bootstrapper) – establishes minimal shared contract & dual-layer (P0 local vs shared index) separation (auto-seeded if missing).
2. `001-knowledge-index-lifecycle.md` (category: lifecycle) – formalizes capture → validation → scoring → selective promotion workflow.

Categories (see constitution for full list): bootstrapper, lifecycle, governance, integration, diagnostics, performance.

Authoring template: `../templates/spec-template.md`.

## Archived (Historical / Temporal)

Located under `archive/<year>/`:

| Year | Files (examples) | Notes |
|------|------------------|-------|
| 2025 | `ACTIVATION_ENHANCEMENTS.md`, `CRUD-REPRO-CASES.md`, `INTERNAL-BASELINE.md`, `PERFORMANCE.md`, `CHECKPOINT-feedback-analysis-2025-08-30.md`, `HEALTH-CHECKPOINT-2025-08-31.md`, `SESSION_LOG_20250827.md`, `FEEDBACK-ANALYSIS-*.md`, `FEEDBACK-REPORT-*.md`, `AGENT-STATE-2025-08-31.json` | Point-in-time analyses, session traces, debug artifacts |
| 2026 | `GITHUB-SPEC-KIT-COMPLIANCE.md` | One-time compliance review snapshots |

## Policy

See `archive/README.md` for retention guidance. Archived files should not be updated; create new active docs instead or add addenda to canonical documents.

## Recent Cleanup (2026-03-01)

Consolidated and normalized docs folder:
- **Deleted 7 duplicate debug artifacts** already in `archive/2025/`
- **Archived 5 debug artifacts** to appropriate year folders
- **Deleted 2 empty files** and orphaned folders (`image/`, `panels/`)
- **Consolidated 3 image folders** into single `screenshots/` folder
- **Moved** `diagram-viewer.html` to `scripts/`
- **Normalized filenames**: `PROJECT_PRD.md` → `PROJECT-PRD.md`, `AGENT_EXECUTION_DIRECTIVE.md` → `AGENT-EXECUTION-DIRECTIVE.md`, `knowledge-api-spec.md` → `KNOWLEDGE-API-SPEC.md`, `runtime-config-mapping.md` → `RUNTIME-CONFIG-MAPPING.md`

## Previous Cleanup (2026-01-28)

Removed 17 documents as part of GitHub Spec-Kit compliance audit:
- Completed plans, migrations/fixes, deprecated PRD stubs, outdated stubs, generated duplicates, archived temporal docs
