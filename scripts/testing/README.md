# scripts/testing

Test runners, helpers, fixtures, and Playwright utilities. These support the
`vitest` unit/integration suite and the Playwright E2E suite; they are called
by `package.json` scripts or `npm test`.

## Scripts

| Script | Purpose |
|--------|---------|
| `test-fast.mjs` | Run the fast (unit-only) test suite with optimized vitest config |
| `test-slow.mjs` | Run the slow (integration + E2E) suite |
| `slow-tests.mjs` | Discover and list slow tests by measured duration |
| `pretest-build-or-skip.mjs` | Before tests: build if `dist/` is stale; skip build in CI if fresh |
| `pretest-build-or-skip.ps1` | PowerShell wrapper for `pretest-build-or-skip.mjs` |
| `run-playwright.mjs` | Launch Playwright E2E suite with the right server lifecycle |
| `run-adversarial-tests.mjs` | Run adversarial / fuzz test scenarios |
| `seed-dashboard-fixtures.mjs` | Seed the test database with dashboard fixture data |
| `seed-dashboard-fixtures.ts` | TypeScript source for the fixture seeder |
| `capture-screenshots.mjs` | Playwright screenshot capture for visual regression baseline |
| `crud-response-validation.ps1` | PowerShell: call CRUD endpoints and validate response shapes |
| `test-hook-regressions.ps1` | Re-run hook-related regression tests in isolation |

## Entry points

```pwsh
# Full test suite
npm test

# Fast unit-only pass
npm run test:fast

# Playwright E2E
npm run test:e2e
```

> See `docs/testing.md` and `docs/testing_strategy.md` for full strategy.
