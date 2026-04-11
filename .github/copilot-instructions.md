# Index Server — Copilot Instructions

## Search Order
- Start with the current implementation surface: nearby code, tests, and repo docs.
- Then read `.instructions/local/` for repo-specific guidance.
- Then read `.instructions/shared/` for validated reusable repo guidance.
- Treat `instructions/` as the checked-in runtime instruction catalog for the server, not as a replacement for repo-local guidance.
- If available, query index-server for validated prior learnings, bootstrap guidance, and cross-repo standards.
- Use external docs only when the repo and index sources are insufficient.

## Constitution And Versioning
- `constitution.json` is binding for this repo.
- When `constitution.json` changes, regenerate both `constitution.md` and `.specify/memory/constitution.md` with `pwsh -File scripts/sync-constitution.ps1`.
- Existing repos should adopt template changes as versioned deltas, not wholesale replacements.
- Record template-alignment status in `.template-adoption.json`.
- Keep `template-manifest.json`, adoption guidance, and helper scripts aligned when template-managed behavior changes.

## Repository Standard
- This repository uses `pre-commit` as the single Git hook orchestrator.
- Hook logic for this repo intentionally lives in `scripts/` and `.pre-commit-config.yaml` rather than `hooks/`; preserve that unless the repo explicitly changes standards.
- Do not add Husky on top of `pre-commit` unless the repo intentionally replaces `pre-commit` and documents that decision.

## Security Gates
- Preserve the layered hook model: forbidden file blocking, curated PII scanning, live env-value leak scanning, standard secret scanners, and protected-remote enforcement.
- When changing hook logic, update the matching docs and local instructions.
- Avoid weakening allowlists without explicit rationale.

## Local Instructions
- Keep repo-specific context under `.instructions/local/`.
- Keep reusable, validated repo guidance under `.instructions/shared/`.
- `instructions/` remains the repo's checked-in instruction catalog and bootstrap seed surface.

## Index Server
- Use index-server for validated local or cross-repo knowledge, not for reading current file contents.
- Start with `help_overview`, then use `index_search` and `index_dispatch` to fetch only the instructions needed for the current task.
- Prefer the local-first flow: repo files -> `.instructions/` -> index-server -> external docs.
- Start new learnings in `.instructions/` first, then promote stable patterns with `promote_from_repo` and `.specify/config/promotion-map.json`.
- Treat index entries as promoted snapshots, not as proof that matching files must exist in the current workspace.

## Optional Profiles
- `.specify/` scaffolding is optional. Use it for larger planned changes, not as a mandatory runtime dependency for every task.
- `squad` may complement repo workflows, but it does not replace repo-local instructions or index-server promotion.

## Validation
- Run focused `pre-commit run --files ...` checks on touched files before broader validation when practical.
- Run `pre-commit run --all-files` after hook changes.
- Run `pwsh -File scripts/sync-constitution.ps1 -Check` after constitution changes.
- Keep CI aligned with local enforcement.

## Project Overview
Index Server is an instruction indexing platform for AI assistant
governance. It implements the Model Context Protocol (MCP) to provide structured knowledge
management — index CRUD, search, governance hashing, schema validation, usage tracking,
and cross-repo knowledge promotion.

## Tech Stack
- **Language**: TypeScript (strict mode, CommonJS output)
- **Runtime**: Node.js ≥20 <23
- **Protocol**: MCP (Model Context Protocol) via `@modelcontextprotocol/sdk`
- **Testing**: vitest (unit), Playwright (e2e), fast-check (property-based)
- **Build**: `tsc` + custom asset copy scripts
- **Lint**: ESLint + Prettier
- **Schema**: JSON Schema (ajv) + Zod for runtime validation
- **Dashboard**: Express + WebSocket admin UI

## Development Rules
1. Follow the constitution in `.specify/memory/constitution.md` and `constitution.json`
2. Use spec-driven development: specify → plan → tasks → implement
3. Never push without explicit user approval
4. Tests before implementation (TDD red-green-refactor)
5. All env config via `src/config/runtimeConfig.ts` — never hardcode paths or secrets
6. Conventional commits required (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`)

## Architecture Quick Reference
- **Handler Pattern**: `registerHandler('tool_name', (params) => result)` in `src/server/registry.ts`
- **Tool Registry**: `INPUT_SCHEMAS`, `STABLE` set, `MUTATION` set in `src/services/toolRegistry.ts`
- **Side-effect Import**: New handlers register via import in `src/services/toolHandlers.ts`
- **Index State**: `IndexContext` (`ensureLoaded`, `writeEntry`, `invalidate`) is the single source of truth
- **Audit**: Mutation ops must call `logAudit()` from `src/services/auditLog.ts`
- **Schema Version**: Tracked in `src/versioning/schemaVersion.ts`

## Key Files
| Purpose | Path |
|---------|------|
| Architecture | `docs/architecture.md` |
| Product Requirements | `docs/project_prd.md` |
| Tool Reference | `docs/tools.md` |
| Contributing Guide | `CONTRIBUTING.md` |
| Changelog | `CHANGELOG.md` |
| Constitution (machine) | `constitution.json` |
| Constitution (readable) | `.specify/memory/constitution.md` |
| Instruction Schema | `schemas/instruction.schema.json` |
| Runtime Config | `src/config/runtimeConfig.ts` |

## Build & Test Commands
```bash
npm run build          # tsc + copy dashboard assets
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm test               # vitest run (all tests)
npm run coverage       # vitest with coverage
```

## Available Slash Commands
- `/speckit.constitution` — Review or amend project principles
- `/speckit.specify` — Create a feature specification
- `/speckit.plan` — Generate technical implementation plan
- `/speckit.tasks` — Break plan into actionable tasks
- `/speckit.implement` — Implement from task list

## MCP Integration
This repo **is** the Index Server. It serves its own instruction index and can be
queried for organizational knowledge.

### Searching the Index
```
Use index_search with keywords to find relevant guidance.
Use index_dispatch with action="get" and id="<instruction-id>" for full content.
```

### Promoting Knowledge
```
Use promote_from_repo to scan a local repo and promote its knowledge into the index.
```

### Key Tool Categories
- **Read**: `index_search`, `index_dispatch` (get/list/query/export)
- **Write (mutation)**: `index_add`, `index_import`, `index_remove`, `promote_from_repo`
- **Governance**: `index_health`, `index_repair`, `index_normalize`
- **Usage**: `usage_track`, `usage_hotset`
- **Feedback**: `feedback/submit`, `feedback/list`, `feedback/stats`

## Anti-Patterns
- Do NOT bypass `IndexContext` to write instruction files directly
- Do NOT hardcode file paths — use `runtimeConfig` and env vars
- Do NOT skip `logAudit()` for mutation operations
- Do NOT add tools without updating `toolRegistry.ts` (INPUT_SCHEMAS + sets + describeTool)
- Do NOT push without user approval
- Do NOT duplicate MCP index instructions locally — reference by ID from the index
