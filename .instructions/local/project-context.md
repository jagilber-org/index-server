# Project Context

Index Server is a TypeScript MCP server that indexes governed instruction content and exposes search, dispatch, governance, usage, and promotion operations.

Repo-specific notes:

- `instructions/` is part of the product surface and stores bootstrap instruction entries and manifest data.
- `.instructions/` is the local guidance layer for humans and agents working in this repository.
- Do not check transient scan triage or reconciliation reports into `docs/`; keep them out of the repository unless a human explicitly asks for a permanent document.
- `constitution.json` is the governance source of truth.
- `sync-constitution.cjs` is the implementation entry point; `scripts/sync-constitution.ps1` is the PowerShell wrapper used by template-aligned workflows.
- Security hooks are orchestrated through `pre-commit` with repo logic in `scripts/pre-commit.ps1`, `scripts/pre-push.ps1`, and `scripts/pre-push-public-guard.cjs`.
