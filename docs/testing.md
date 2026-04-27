# Test Artifact Management Guide

## Overview

This document explains how test artifacts are managed in the `index-server` project.

**Key principle:** Tests MUST NOT write to the repo root. All test suites use isolated
temporary directories (via `os.tmpdir()` or `process.cwd()/tmp/`) for instruction files.
The repo root does not contain an `instructions/` directory.

## Test Isolation Strategy

### 1. Temp Directory Isolation (PRIMARY)

All test suites that create instruction files use isolated temp directories:

```typescript
import os from 'os';
import path from 'path';
import fs from 'fs';

describe('myTestSuite', () => {
  const TEST_DIR = path.join(os.tmpdir(), `index-server-test-mysuite-${process.pid}`);

  beforeAll(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterAll(() => {
    try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('creates test file', () => {
    // Pass TEST_DIR via extraEnv for handshake tests:
    const { server, parser } = await performHandshake({
      extraEnv: { INDEX_SERVER_DIR: TEST_DIR }
    });
    // Or set process.env for direct-import tests:
    process.env.INDEX_SERVER_DIR = TEST_DIR;
  });
});
```

### 2. Handshake Tests (spawn child server)

Tests using `performHandshake()` must pass `INDEX_SERVER_DIR` via `extraEnv`:

| Test Suite | Isolation |
|-----------|-----------|
| `createReadSmoke.spec.ts` | `extraEnv: { INDEX_SERVER_DIR }` |
| `addVisibilityInvariant.spec.ts` | `extraEnv: { INDEX_SERVER_DIR }` |
| `manifestEdgeCases.spec.ts` | `extraEnv: { INDEX_SERVER_DIR }` |
| `governanceRecursionGuard.spec.ts` | Passes to `spawnServer()` |

### 3. Direct-Import Tests

Tests that import `indexContext` directly set `process.env.INDEX_SERVER_DIR` before the import:

| Test Suite | Notes |
|-----------|-------|
| `indexContext.usage.unit.spec.ts` | Sets env before importing indexContext |
| `usageSignal.unit.spec.ts` | Sets env before importing indexContext |
| `metaHints.unit.spec.ts` | Sets env before importing handlers |

### 4. Tests Using `createTestClient()`

Tests using the MCP test client helper pass `instructionsDir` option, which sets
`INDEX_SERVER_DIR` internally:

```typescript
const client = await createTestClient({ instructionsDir: tmpDir });
```

## .gitignore Safety Net

The `.gitignore` retains patterns as a secondary defense against repo root writes:

```gitignore
instructions/
```

This prevents any accidental repo-root instruction directory from being committed.

## Best Practices

### DO ✅

1. **Use `os.tmpdir()` for test directories** — never write to repo root
2. **Pass `INDEX_SERVER_DIR` to child processes** — via `extraEnv` or env
3. **Clean up in afterAll** — use `fs.rmSync(dir, { recursive: true, force: true })`
4. **Use `process.pid` in dir names** — prevents collision between parallel test runs

### DON'T ❌

1. **Don't hardcode `process.cwd()/instructions`** — use temp dirs
2. **Don't skip INDEX_SERVER_DIR** — all test servers need explicit dirs
3. **Don't create directories in repo root** — use `tmp/` or `os.tmpdir()`
4. **Don't rely on .gitignore alone** — isolation is the primary defense

## External-Tool Gating Pattern

Some integration tests need an external binary (e.g., `openssl`) that may
not be present on every CI image. These tests use a `spawnSync` probe in
`beforeAll` and gate each case with `it.skipIf(!available)` so missing
prerequisites produce **clean skips, not failures**.

Examples:

- `src/tests/dashboardTls.spec.ts` — original openssl-gated TLS smoke.
- `src/tests/certInit.spec.ts` — `--init-cert` integration tests; logs
  `[certInit.spec] opensslAvailable=<bool> reason="..."` to make the gate
  decision visible in CI output.
- `src/tests/unit/certInit.unit.spec.ts` and
  `src/tests/unit/cliParseInitCert.unit.spec.ts` — pure unit tests for the
  same module; do not require openssl and run on every image.

## Related Files

- `.gitignore`: Safety-net patterns
- `scripts/validate-no-test-artifacts.mjs`: CI validation script
- `src/tests/helpers/mcpTestClient.ts`: Test client helper (passes INDEX_SERVER_DIR)
- `CONTRIBUTING.md`: Repo root policy
