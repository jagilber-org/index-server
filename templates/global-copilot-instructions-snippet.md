# Index Server — Global Copilot Instructions Snippet

Add this to your global `~/.github/copilot-instructions.md` to enable index-server
awareness across all repositories.

## Snippet

````markdown
## Index Server

- If index-server MCP tools are available, use them as a shared knowledge base for validated cross-repo patterns, standards, and learnings.
- **Search before creating**: Use `index_search` with 2–5 keywords to find existing guidance before adding new instructions.
- Default retrieval loop: `index_search` → inspect top 1–3 results → `index_dispatch` with action="get" for full content.
- After learning something reusable, promote it: validate locally in `.instructions/` → then `promote_from_repo` or `index_add`.
- Index entries are promoted snapshots, not proof that matching files exist in the current workspace. Always prefer current repo files.
- Do not store ephemeral task notes or scratch data in the index.
````
