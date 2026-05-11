# scripts/governance

Quality gates, coverage enforcement, security scanners, and validation scripts.
These are called by `package.json` (`npm run guard:*`), pre-commit hooks, and CI
workflows. Adding a new gate here means wiring it into one of those entry points.

## Scripts

| Script | Category | Purpose |
|--------|----------|---------|
| `baseline-sentinel.mjs` | baseline | Assert metric baselines have not regressed |
| `check-coverage.mjs` | coverage | Fail if coverage drops below thresholds |
| `check-no-skips.mjs` | coverage | Fail if any test uses `.skip` or `xit` |
| `check-version-parity.mjs` | release | Assert `package.json` version matches `CHANGELOG.md` |
| `coverage-alias.cjs` | coverage | CJS shim so `npm run coverage` resolves correctly |
| `coverage-ratchet.mjs` | coverage | Ratchet coverage floor up after improvements |
| `enforce-config-usage.ts` | lint | Ensure all env vars are accessed via `runtimeConfig` |
| `flake-baseline-generate.mjs` | flake | Generate a new flake baseline from current test results |
| `flake-gate.mjs` | flake | Block if flake rate exceeds baseline |
| `flake-sentinel.mjs` | flake | Persist flake observations for trend analysis |
| `flake-trend.mjs` | flake | Report flake trend over recent runs |
| `guard-baseline.mjs` | baseline | Guard: fail if any baseline metric is missing |
| `guard-declarations.mjs` | lint | Guard: ensure all exported symbols have JSDoc |
| `lint-instructions.mjs` | lint | Lint instruction JSON files against the schema |
| `purge-extra-decls.mjs` | lint | Remove orphaned declaration files from `dist/` |
| `security-scan.mjs` | security | Lightweight JS security pattern scan |
| `security-scan.ps1` | security | PowerShell wrapper for the full security scan suite |
| `unicode-scanner.js` | security | Detect Unicode direction-override characters (trojan-source) |
| `validate-governance.mjs` | validation | End-to-end governance gate runner |
| `validate-no-test-artifacts.mjs` | validation | Ensure no test-only artifacts exist in `dist/` |
| `validate-security-headers.mjs` | validation | Assert all HTTP responses include required security headers |
| `validate-template-metadata.ps1` | validation | Validate template adoption metadata JSON |
| `verify-manifest.mjs` | validation | Verify `schemas/manifest.json` matches `package.json` |

## Entry points

```pwsh
# Run all governance gates
npm run guard:all

# Coverage gate only
npm run guard:coverage

# Template adoption metadata alignment
npm run validate:template
```
