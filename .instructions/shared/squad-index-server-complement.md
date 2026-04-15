# Squad And Index-Server Complement

`squad`, repo-local instructions, and index-server solve different problems.

## Recommended Role Split

- `squad`: persistent team state, orchestration, routing, and shared decisions for the current repo
- `.instructions/`: repo-local guidance and validated patterns that should live with the codebase
- index-server: governed retrieval and promotion layer for reusable knowledge across sessions or repos

## Working Agreement

1. Do not treat `squad` history as a substitute for repo instructions.
2. Move durable guidance from ad hoc team state into `.instructions/` when it becomes stable.
3. Promote only validated, reusable patterns into index-server.
4. Keep repo-specific team preferences local unless they are broadly useful.

## Spec-Driven Work

If the repo uses `.specify/` templates, they define proposed work and implementation intent.

That complements `squad` and index-server rather than replacing them:

- `.specify/` structures upcoming work
- `squad` helps execute and coordinate work
- `.instructions/` captures validated repo-local guidance
- index-server stores reusable promoted knowledge
