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
- Only call out a repo mismatch when you verify the current workspace paths or promotion map against actual checked-in files.

## Minimal Usage Pattern

If index-server is available:

1. call `help_overview` for onboarding and tool discovery
2. call `index_search` with focused keywords
3. fetch only the instructions needed for the current task
4. keep new learnings local first, then promote stable patterns later

## Local-First Knowledge Flow

1. Agent solves or validates a repo-specific pattern.
2. Guidance is written under `.instructions/`.
3. Agent-only operational learnings that should not become template contract belong in repo memory rather than versioned docs.
4. The pattern is validated across sessions or repos.
5. The repo's promotion map is used to promote stable guidance into index-server.

## Storage Boundary

- Put contract-level, adopter-facing guidance in versioned files under `.instructions/`.
- Put agent-only operational learnings in repo memory so future cold agents can benefit without turning transient behavior into template contract.
- Promote to index-server only after the local guidance proves stable and reusable.

## Promotion Reminder

Use `.specify/config/promotion-map.json` as the starting point when deciding which local docs are candidates for promotion.
