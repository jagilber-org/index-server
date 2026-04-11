---
description: "Create a feature specification"
---

# Feature Specification

You are creating a feature specification for **Index**.

## Instructions

1. Read the user's feature description carefully.
2. Use the template at `.specify/templates/spec.md` as the structure.
3. Create a new spec directory: `specs/NNN-<feature-name>/spec.md` where NNN is the next sequential number.
4. Fill in: Summary, Problem Statement, Requirements, Success Criteria, Non-Goals, Technical Considerations, Dependencies, and Risks.
5. Reference the architecture in `docs/architecture.md` and the PRD in `docs/project_prd.md` for context.
6. For MCP tool features, note the handler pattern: `registerHandler()` → `toolRegistry.ts` → `toolHandlers.ts` side-effect import.

## Context Files
- `.specify/templates/spec.md` — Spec template
- `docs/architecture.md` — Architecture reference
- `docs/project_prd.md` — Product requirements
- `constitution.json` — Quality gates
