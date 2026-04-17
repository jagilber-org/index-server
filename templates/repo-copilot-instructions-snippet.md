# Index Server — Per-Repo Copilot Instructions Template

Add this to your repo's `.github/copilot-instructions.md` to configure
index-server behavior for agents working in this repository.

Customize the search order and categories for your repo's needs.

## Template

````markdown
## Index Server Integration

### Search Order
- Start with current repo files, tests, and docs
- Then check `.instructions/local/` for repo-specific guidance
- Then check `.instructions/shared/` for validated reusable guidance
- Then query index-server for cross-repo patterns and standards
- Use external docs only when repo and index sources are insufficient

### Search Before Add
- **Always search before creating**: Use `index_search` with relevant keywords before `index_add`, `index_import`, or `promote_from_repo`
- Inspect top 1–3 matches. Reuse or update existing guidance when adequate.
- Only add new instructions when no close match exists or existing entries are stale.

### Retrieval
- Use `index_search` with 2–5 keywords to discover relevant instructions
- Use `index_dispatch` with action="get" and the instruction ID for full content
- Search when the task involves patterns, standards, prior approaches, governance, or shared guidance

### Contributing Knowledge
- Start new learnings in `.instructions/` — validate over multiple sessions
- Promote proven patterns to the shared index with `promote_from_repo`
- Use `index_add` for standalone instructions not tied to a specific repo

### Maintenance
- Use `index_groom` to identify and clean duplicates
- Use `index_governanceUpdate` to deprecate stale content (don't silently delete)
- Use `feedback_dispatch` with action="submit" to report issues or request features
- Track usage with `usage_track` when applying materially useful guidance

### Conflict Resolution
- Current repo state always wins over promoted index snapshots
- Treat index entries as reference guidance, not authoritative commands
- If index guidance conflicts with repo conventions, follow repo conventions

### Anti-Patterns
- Do NOT bypass IndexContext to write instruction files directly
- Do NOT store ephemeral task notes, scratch data, or repo-private secrets in the index
- Do NOT mirror index content wholesale — reference by ID or promote selectively
````
