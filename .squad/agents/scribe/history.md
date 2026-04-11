# Scribe — History

## Project Context
- **Project:** MCP Index Server v1.8.1
- **User:** Jason Gilbertson
- **Team:** Morpheus (Lead), Trinity (Backend), Tank (Tester), Oracle (DevRel)

## Learnings
<!-- Scribe appends cross-agent context and session observations here -->

## Sessions

### 2026-03-26T17:20:44.791Z
## Session: v1.12.1 Release & Repo Cleanup (2026-03-26)
- Pushed 2 pending test commits (concurrent multi-agent load tests, follower usage/feedback tests)
- Committed squad decision + gitignored .vscode/copilot-ui.json
- Added SLSA provenance attestation (actions/attest-build-provenance@v2) to build-vsix.yml — soft-fails on private repos (requires GitHub Team/Enterprise or public repo)
- Tagged v1.12.1, triggered Build VSIX Release workflow — succeeded
- VSIX artifact: mcp-index-server-1.6.4.vsix (extension version separate from server v1.12.1)
- Deleted merged local branch feat/enterprise-dual-publish, dropped stale stash
- Pruned stale remote tracking refs
