# Index Server Bootstrap

Use index-server as the governed retrieval layer for validated project knowledge.

## Default Retrieval Order

1. Read nearby code, tests, and repo docs first.
2. Read `.instructions/local/` for repo-specific guidance.
3. Read `.instructions/shared/` for validated reusable patterns.
4. Query index-server for validated prior learnings and shared standards.
5. Use external docs only when repo and index sources are insufficient.

## What Index Server Is For

- validated prior learnings from previous sessions
- reusable patterns promoted from local repo instructions
- cross-repo governance and bootstrap guidance
- canonical standards that outlive a single workspace session

## What It Is Not For

- reading current file contents
- replacing nearby code or test inspection
- bypassing repo-local instructions
- storing unvalidated experimental notes as shared truth

## Important Boundary

- Index entries are promoted snapshots of validated guidance, not a live mirror of the current workspace.
- An instruction returned from index-server does not imply that a same-named file must exist under `.instructions/` in the current repo.
- Treat missing local files and promoted index entries as different facts unless the current repo's checked-in promotion metadata explicitly says they should align.

## Minimal Usage Pattern

1. Call `help_overview` for onboarding and tool discovery.
2. Call `index_search` with focused keywords.
3. Fetch only the instructions needed for the current task.
4. Keep new learnings local first, then promote stable patterns later.
