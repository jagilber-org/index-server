---
description: "Generate a technical implementation plan from a specification"
---

# Implementation Plan

You are generating a technical implementation plan for **Index**.

## Instructions

1. Read the specification from `specs/NNN-<feature-name>/spec.md`.
2. Use the template at `.specify/templates/plan.md`.
3. Create `specs/NNN-<feature-name>/plan.md`.
4. Detail: Architecture overview, implementation phases (handler → registry → testing → docs), data model changes, rollback plan, and effort estimate.
5. For MCP tools: handler in `src/services/handlers.<name>.ts`, registry in `src/services/toolRegistry.ts`, import in `src/services/toolHandlers.ts`.

## Context Files
- `.specify/templates/plan.md` — Plan template
- `docs/architecture.md` — Architecture reference
- `src/services/toolRegistry.ts` — Existing tool patterns
- `src/server/registry.ts` — Handler registration
