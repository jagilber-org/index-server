---
description: "Implement features from a task list"
---

# Implementation

You are implementing features from the task list for **Index**.

## Instructions

1. Read the tasks from `specs/NNN-<feature-name>/tasks.md`.
2. Work through tasks sequentially, marking each complete.
3. Follow TDD: write failing tests first, then implement to pass.
4. For MCP tool handlers:
   - Create handler in `src/services/handlers.<name>.ts` using `registerHandler()` from `../server/registry`
   - Add input schema to `INPUT_SCHEMAS` in `src/services/toolRegistry.ts`
   - Add to `STABLE` or `MUTATION` set
   - Add `describeTool()` case
   - Add side-effect import in `src/services/toolHandlers.ts`
   - Call `logAudit()` for mutations
5. Validate: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`
6. Update docs: `docs/tools.md`, `CHANGELOG.md`, bump `package.json` version
7. Conventional commit: `feat:`, `fix:`, etc.
8. NEVER push without explicit user approval.

## Context Files
- `constitution.json` — Quality gates
- `src/server/registry.ts` — Handler registration pattern
- `src/services/toolRegistry.ts` — Tool registry
- `src/services/toolHandlers.ts` — Side-effect imports
- `docs/tools.md` — Tool documentation
