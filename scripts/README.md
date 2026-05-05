# Scripts Directory

Organized by purpose. Each subdirectory has a clear role; naming conventions make intent obvious at a glance.

## Directory Structure

| Directory | Purpose | Naming Convention |
|-----------|---------|-------------------|
| `build/` | Build, release, asset generation | `generate-*`, `copy-*`, `bump-*`, `build-*` |
| `ci/` | CI-specific runners and validation | — |
| `client/` | Client CLI tools and wizards | — |
| `deploy/` | Deployment and production ops | `deploy-*`, `smoke-*`, `prod-*` |
| `diagnostics/` | Adhoc probes, health checks, inspection | `adhoc-*` for one-off probes |
| `dist/` | Distributable scripts (shipped to users) | — |
| `governance/` | Guards, validators, lint, coverage | `guard-*`, `check-*`, `validate-*` |
| `hooks/` | Git hook implementations | `pre-commit*`, `pre-push*`, `commit-msg*` |
| `mappings/` | Configuration mappings | — |
| `migration/` | One-time data migrations (keep for history) | — |
| `perf/` | Performance baselines, trends, benchmarks | `perf-*`, `benchmark-*`, `stress-*` |
| `testing/` | Test runners, helpers, fixtures | `test-*`, `run-*`, `seed-*` |

## Naming Conventions

- **`adhoc-*`** — One-off diagnostic probes. Never referenced by CI or `package.json`. Safe to run manually during debugging; safe to delete when no longer needed.
- **`guard-*` / `check-*` / `validate-*`** — Governance gates. Referenced by package.json `guard:*` scripts or CI.
- **`generate-*`** — Code/doc/schema generators that produce artifacts.
- **`run-*`** — Wrappers that invoke test suites or tools with specific config.

## Adding New Scripts

1. **Pick the right directory** based on the table above.
2. **Use the naming convention** for that directory.
3. **Prefer `.mjs`** (ESM) over `.js`/`.cjs` for new scripts.
4. **If it's a one-off probe**, prefix with `adhoc-` and put in `diagnostics/`.
5. **If it needs to be referenced** from `package.json` or `.pre-commit-config.yaml`, note that in a comment at the top of the script.

## Migration Status

This reorg is in progress. Scripts are being moved category-by-category:
- [x] `diagnostics/` — adhoc probes, health checks
- [x] `hooks/` — git hook scripts
- [x] `client/` — client CLI tools
- [x] `build/` — build and release tools
- [x] `governance/` — guard and validation scripts
- [x] `perf/` — performance tools
- [x] `testing/` — test runners
- [x] `deploy/` — deployment scripts
- [x] `migration/` — one-time migrations
