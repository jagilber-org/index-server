# Test Artifact Management Guide

## Overview

This document explains how test artifacts are managed in the `index-server` project, particularly for tests that interact with the `instructions/` directory.

## Problem Statement

Several test suites need to create temporary instruction files in the `instructions/` directory during execution:

- **createReadSmoke.spec.ts**: Creates `smoke-*.json` files
- **manifestEdgeCases.spec.ts**: Creates `mw-disabled-*.json` and `mw-repair-*.json` files  
- **addVisibilityInvariant.spec.ts**: Creates `vis-*.json` files
- **IndexContext.usage.unit.spec.ts**: Creates `unit_p0_materialize_*.json` files
- **Dashboard synthetic tests**: Create `synthetic-*.json` files

**Prior Issue**: These test files were being committed to the repository, causing:
1. Repository bloat (~510 test artifact files)
2. CI failures in `instruction-bootstrap-guard` workflow
3. Manifest drift detection
4. Unclear ownership and governance status

## Permanent Solution

### 1. Test Cleanup (PRIMARY DEFENSE)

All test suites that write to `instructions/` **MUST** implement cleanup in `afterAll()` hooks:

```typescript
describe('myTestSuite', () => {
  const createdTestIds: string[] = [];
  const INDEX_SERVER_DIR = path.join(process.cwd(), 'instructions');

  // Register test IDs for cleanup
  it('creates test file', () => {
    const testId = 'prefix-' + Date.now();
    createdTestIds.push(testId); // ← CRITICAL: Register for cleanup
    // ... test logic
  });

  // Cleanup after all tests complete
  afterAll(() => {
    for (const testId of createdTestIds) {
      const filePath = path.join(INDEX_SERVER_DIR, `${testId}.json`);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        process.stderr.write(`[cleanup] failed to remove ${testId}: ${err}\n`);
      }
    }
  });
});
```

**Why afterAll?**
- Runs after all tests in the suite complete
- Ensures cleanup happens even if tests fail
- Non-blocking (doesn't fail the test suite if cleanup fails)

### 2. .gitignore Protection (SECONDARY DEFENSE)

Test artifact patterns are explicitly excluded in `.gitignore`:

```gitignore
# Test-generated instruction artifacts
instructions/smoke-*.json
instructions/mw-disabled-*.json
instructions/mw-repair-*.json
instructions/vis-*.json
instructions/synthetic-*.json
instructions/unit_p0_materialize_*.json
instructions/unit_usageMonotonic_*.json
```

This prevents accidental commits if cleanup fails or is interrupted.

### 3. CI Validation (ENFORCEMENT LAYER)

The `scripts/validate-no-test-artifacts.mjs` script runs during CI builds:

```yaml
- name: Validate no test artifacts in instructions
  run: node scripts/validate-no-test-artifacts.mjs
```

**What it does:**
- Scans `instructions/` for known test artifact patterns
- Fails the build if ANY test artifacts are found
- Provides clear error messages indicating which tests failed cleanup

**When it runs:**
- After build, before running tests
- Ensures clean state before test execution
- Catches cleanup failures from previous runs

### 4. Documentation (THIS FILE)

Explains:
- Why `instructions/` is production-only
- How to write tests that create temporary files
- What patterns to use for test artifacts
- How the prevention mechanisms work

## Best Practices

### DO ✅

1. **Use timestamp-based IDs**: `'prefix-' + Date.now()` ensures unique names
2. **Register for cleanup**: Push test IDs to array immediately after creation
3. **Use descriptive prefixes**: Makes pattern matching in .gitignore easier
4. **Log cleanup failures**: Use `process.stderr.write()` for diagnostics
5. **Test cleanup locally**: Run `npm test` and verify no artifacts remain

### DON'T ❌

1. **Don't rely on .gitignore alone**: Cleanup MUST happen in tests
2. **Don't skip afterAll**: Even if tests fail, cleanup must run
3. **Don't use production-like names**: Test artifacts should be obviously test artifacts
4. **Don't commit test artifacts**: If you see them in git status, something is wrong
5. **Don't modify instructions/ manually during tests**: Use the test's own cleanup

## Naming Conventions

Test artifact prefixes by test suite:

| Prefix | Test Suite | Purpose |
|--------|-----------|---------|
| `smoke-` | createReadSmoke.spec.ts | Production deployment smoke tests |
| `mw-disabled-` | manifestEdgeCases.spec.ts | Manifest write disabled test |
| `mw-repair-` | manifestEdgeCases.spec.ts | Manifest repair test |
| `vis-` | addVisibilityInvariant.spec.ts | Visibility invariant tests |
| `synthetic-` | Dashboard API | Synthetic load tests |
| `unit_p0_materialize_` | IndexContext.usage.unit.spec.ts | Materialization tests |
| `unit_usageMonotonic_` | IndexContext.usage.unit.spec.ts | Usage tracking tests |

**Add new prefixes to:**
1. Test's afterAll cleanup logic
2. `.gitignore` patterns
3. `scripts/validate-no-test-artifacts.mjs` patterns
4. This documentation table

## Troubleshooting

### "Test artifacts detected" CI failure

**Cause**: Test cleanup hooks failed or were not executed

**Fix**:
1. Run locally: `node scripts/validate-no-test-artifacts.mjs`
2. See which artifacts exist
3. Clean manually: `Remove-Item instructions/smoke-*.json, instructions/mw-*.json, instructions/vis-*.json, instructions/synthetic-*.json, instructions/unit_*.json`
4. Verify cleanup hooks exist in the test file
5. Run tests locally and verify cleanup works

### Test creates files but cleanup doesn't work

**Cause**: Test ID not registered in `createdTestIds` array

**Fix**:
1. Add `createdTestIds.push(testId)` immediately after ID creation
2. Verify `afterAll` hook exists and iterates over the array
3. Check for exceptions during cleanup (logged to stderr)

### Git shows test artifacts in status

**Cause**: Either:
- Cleanup failed during test execution
- Pattern not in .gitignore

**Fix**:
1. **Do NOT commit these files**
2. Remove them: `git clean -f instructions/smoke-*.json` (etc.)
3. Verify pattern exists in .gitignore
4. Add pattern if missing
5. Run `node scripts/validate-no-test-artifacts.mjs` to verify

## Implementation History

**Problem discovered**: September 30, 2025
- ~510 test artifact files committed to repository
- CI workflows failing with "Index enrichment drift"
- Manifest count mismatch (1 vs 510+ files)

**Root cause**: Tests writing to `instructions/` without cleanup

**Solution implemented**:
1. Added afterAll cleanup to 4 test suites
2. Enhanced .gitignore with documented patterns
3. Created validate-no-test-artifacts.mjs enforcement script
4. Added CI validation step
5. Documented solution (this file)

**Result**: Permanent prevention mechanism with multiple defense layers

## Related Files

- `.gitignore`: Test artifact patterns
- `scripts/validate-no-test-artifacts.mjs`: Validation script
- `.github/workflows/ci-enhanced.yml`: CI enforcement
- `src/tests/createReadSmoke.spec.ts`: Smoke test cleanup
- `src/tests/manifestEdgeCases.spec.ts`: Manifest test cleanup
- `src/tests/addVisibilityInvariant.spec.ts`: Visibility test cleanup
- `src/tests/unit/IndexContext.usage.unit.spec.ts`: Usage test cleanup

## Questions?

See also:
- `CONTRIBUTING.md`: General contribution guidelines
- `README.md`: Project overview and setup
- `docs/testing_strategy.md`: Overall testing approach
