# scripts/ci

CI-specific runners and validation helpers. These run inside GitHub Actions workflows
or are called by the pre-commit/pre-push pipeline. They are not intended for direct
interactive use.

## Scripts

| Script | Purpose |
|--------|---------|
| `audit-ci-artifacts.ps1` | Assert expected build artifacts are present after CI build |
| `audit-ci-artifacts.sh` | Bash equivalent for Linux CI runners |
| `clean-install-smoke.mjs` | Fresh `npm ci` + build + basic import smoke test |
| `copilot-e2e.ps1` | Copilot agent end-to-end scenario runner |
| `ggshield-with-retry.sh` | Run `ggshield` secret scan with automatic retry on transient failures |

## When called

- `audit-ci-artifacts.*` — post-build step in the release workflow
- `clean-install-smoke.mjs` — `npm run ci:smoke` and the nightly clean-install job
- `ggshield-with-retry.sh` — the `ggshield-secret-scans` workflow
- `copilot-e2e.ps1` — the Copilot E2E workflow
