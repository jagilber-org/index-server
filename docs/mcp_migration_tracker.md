# MCP Marketplace Migration — Status Tracker

> Tracking issue: internal release tracker #107
>
> **Migration strategy:** Two-stage cutover — MCP-native first, VSIX retirement only after validation.

## Current State Summary

The migration is **mid-Stage 1, nearing Stage 2 readiness**. MCP Registry metadata, MCP-native install docs, and release workflow auth are complete. The VSIX path is deprecated-but-available as a fallback.

### Identity Resolution

| Attribute | Value | Notes |
|-----------|-------|-------|
| npm package | `@jagilber-org/index-server` | Public-facing identity |
| MCP name | `io.github.jagilber-org/index-server` | In `package.json#mcpName` and `server.json` |
| Dev repo | internal development repository | Private — all development happens outside the mirror |
| Public mirror | `jagilber-org/index-server` | Read-only publication target |
| Release auth | PAT fallback (`MCP_GITHUB_TOKEN`) | Until public mirror owns release execution |

## Stage 1 — MCP-Native Distribution (In Progress)

### Completed ✅

| Work Item | Status | Evidence |
|-----------|--------|----------|
| `package.json#mcpName` added | ✅ Done | Line 4: `"mcpName": "io.github.jagilber-org/index-server"` |
| Root `server.json` created | ✅ Done | Validates against MCP schema `2025-12-11/server.schema.json` |
| Install docs rewritten MCP-native first | ✅ Done | README and `docs/quickstart.md` updated |
| Release workflow updated for MCP Registry | ✅ Done | `release.yml` fails fast if auth missing |
| PAT fallback documented | ✅ Done | `docs/publishing.md` — canonical internal-repo path |
| VSIX marked as deprecated fallback | ✅ Done | Docs and release notes reference VSIX as legacy only |
| npm publish verified | ✅ Done | `npm pack --dry-run` passes; no forbidden artifacts |
| Env-value leak scan on publish | ✅ Done | `publish-direct-to-remote.cjs --verify-only` passes |

### Remaining Stage 1 Work

| Work Item | Status | Blocking? | Notes |
|-----------|--------|-----------|-------|
| `server.json` ↔ `package.json` version alignment test | 🟡 Needs verification | No | Should be validated in CI; check if manifest-verify workflow covers this |
| VS Code MCP gallery install URL tested end-to-end | 🟡 Needs verification | Yes for Stage 2 | Reproducibility must be confirmed before VSIX retirement |
| Legacy VSIX fallback packaging confirmed | ✅ Done | — | Still packages successfully per #107 comment |

## Stage 2 — VSIX Retirement & Extended MCP Surface (Planned)

### Decisions Required Before Stage 2

| Decision | Status | Owner | Notes |
|----------|--------|-------|-------|
| MCP prompts/resources in Stage 2? | Deferred to internal tracker #108 | Product/security review | CLI `--setup` + docs may be sufficient; prompt/resource support is additive |
| VSIX retirement timing | Blocked on gallery validation | Maintainer approval | Only after MCP gallery install + fallback docs verified |
| Release execution moves to public mirror? | Open | Maintainer approval | Would enable OIDC; currently PAT-only from the internal release context |

### Stage 2 Work Items

| Work Item | Status | Depends On |
|-----------|--------|------------|
| MCP prompts/resources implementation | Not started | Decision on #108 |
| VS Code MCP gallery install reproducibility | Not started | Gallery listing live |
| VSIX build/publish removal | Not started | Gallery validation + maintainer approval |
| Extension deprecation notice in Marketplace | Not started | Retirement decision |
| Feature parity audit (VSIX vs MCP) | Not started | Gallery install confirmed |

## CI/CD Alignment

| Workflow | Migration Impact | Status |
|----------|-----------------|--------|
| `release.yml` | Updated for MCP Registry publish with fail-fast auth | ✅ Done |
| `npm-publish.yml` | No changes needed — npm path unchanged | ✅ No action |
| `build-vsix.yml` | Keep during transition; remove only in Stage 2 | 🟡 Pending Stage 2 |
| `manifest-verify.yml` | Should validate `server.json` ↔ `package.json` alignment | 🟡 Verify coverage |

## Follow-Up Issues

| Issue | Description | Status |
|-------|-------------|--------|
| Internal tracker #108 | MCP prompts/resources decision and implementation | Open |
| Internal tracker #109 | Triage pre-existing `build:verify` failures | Open |

## VSIX Deprecation Trigger Criteria

The VSIX distribution path may be retired **only** when all of the following are confirmed:

1. MCP gallery listing is live and discoverable in VS Code's MCP server browser
2. `npx @jagilber-org/index-server@latest` install path is reproducible on Windows, macOS, and Linux
3. Feature parity audit complete — no capability available only through the VSIX
4. At least one full release cycle (minor version bump) has shipped MCP-native without regression reports
5. Maintainers explicitly approve VSIX retirement

Until all five criteria are met, the VSIX path remains available as a documented fallback.

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Gallery listing rejected or delayed | Medium | Blocks Stage 2 | Keep VSIX fallback; don't retire until gallery confirmed |
| PAT token rotation breaks MCP publish | Low | Release blocked | Document rotation procedure; add CI health check |
| `server.json` schema changes upstream | Low | Metadata invalidation | Pin schema version; monitor MCP spec updates |
| Dual identity confusion (dev vs org) | Medium | User confusion | Docs explicitly state public-facing identity is `jagilber-org` |

## Operational Guidance

1. **Do not retire VSIX** until MCP gallery install is reproducible and feature parity is confirmed.
2. **Do not change the MCP namespace** (`io.github.jagilber-org/index-server`) without updating `package.json`, `server.json`, `docs/publishing.md`, and `docs/quickstart.md` in the same commit.
3. **Release from the internal release context** using PAT fallback (`MCP_GITHUB_TOKEN`) until the public mirror owns release execution.
4. **Test registry publishing** with `--dry-run` before any production release.
5. **Keep `server.json` version aligned** with `package.json` version — mismatches will cause registry validation failures.
