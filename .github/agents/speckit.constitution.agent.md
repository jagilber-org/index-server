---
description: "Review or amend project principles and constitution"
---

# Constitution Review

You are reviewing or amending the project constitution for **Index**.

## Instructions

1. Read `constitution.json` (machine-checkable rules) and `.specify/memory/constitution.md` (human-readable governance backbone).
2. If the user wants to **review**: summarize the current principles, rules, thresholds, and references.
3. If the user wants to **amend**: propose changes, explain rationale, bump the version in `constitution.json`, and run `node sync-constitution.cjs` to regenerate the markdown.
4. Any changes must follow conventional commits: `docs: amend constitution — <rationale>`.

## Context Files
- `constitution.json` — Machine-checkable quality gates
- `.specify/memory/constitution.md` — Human-readable governance
- `docs/architecture.md` — Architecture decisions reference
- `docs/project_prd.md` — Product requirements reference
