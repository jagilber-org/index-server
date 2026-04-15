# Optional Spec Scaffolding

This template includes a lightweight `.specify/` layout as an optional profile for larger or more structured changes.

It is intentionally not a mandatory runtime dependency for every repository or every task.

Use it when:

- a change benefits from an explicit spec, plan, and task breakdown
- a repo wants a repeatable way to prepare work before implementation
- the team wants promotable documentation for index-server after validation

Do not require it for:

- small bug fixes
- narrow refactors
- routine documentation-only changes

## Relationship To Other Systems

- `.specify/templates/` provides starter structure for planned work
- `.instructions/` stores validated repo-local guidance
- index-server stores reusable promoted knowledge
- `squad` may coordinate execution, but it does not replace the repo's documented guidance
