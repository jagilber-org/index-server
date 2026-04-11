---
description: "Break an implementation plan into actionable tasks"
---

# Task Breakdown

You are breaking an implementation plan into actionable tasks for **Index**.

## Instructions

1. Read the plan from `specs/NNN-<feature-name>/plan.md`.
2. Use the template at `.specify/templates/tasks.md`.
3. Create `specs/NNN-<feature-name>/tasks.md`.
4. Break into small, testable tasks. Each task should have: title, description, acceptance criteria, and files to touch.
5. Include a validation checklist: tsc --noEmit, lint, vitest run, conventional commit.
6. Order tasks by dependency (handler first, then registry, then tests, then docs).

## Context Files
- `.specify/templates/tasks.md` — Tasks template
- `constitution.json` — Quality gates to enforce
