# CI Investigation Report — Skip Guard and Build Verification

## Summary

- `npm run coverage:ci` succeeds locally (coverage 53.03% ≥ target 50) — no failing tests detected.
- `npm run build:verify` fails during `test:fast` phase because **vitest executes the entire fast suite**, including portable MCP client tests hitting dynamic instruction index files. Execution appears to hang on `src/tests/portableMcpClient.spec.ts`.
- Numerous generated Index JSON files live under `tmp/` and `instructions/`; git status shows untracked modifications that block CI cleanup.
- Root cause: GitHub Actions run likely fails when skip guard or test suite encounters Index drift from locally generated instruction artifacts. Build script expects clean workspace but CI's checkout does not include ephemeral files.

## Reproduction Steps

1. `npm run coverage:ci`
   - Outcome: Pass
2. `npm run build:verify`
   - Steps: build.ps1 → typecheck → build → lint → `npm run test:fast`
   - Outcome: `test:fast` enumerates 115 fast specs; portableMcpClient suite logs 0/2 with instrumentation still Indexing instructions. Process eventually hits guard/timeout.

## Artifacts

- Command outputs stored in `test-results/` (fast suite logs).
- Index generation logs in `tmp/atomic-*` directories reference delta instructions.

## Next Steps

- Clean up or ignore generated Index files under `instructions/` and `tmp/` prior to CI run.
- Consider adding skip guard exemptions or gating for portable client tests that require local instructions not present on CI runner.
- Ensure build script fails fast when workspace has modified Index manifests before running tests.
