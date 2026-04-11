---
name: "testing-patterns"
description: "Vitest TDD patterns, test structure, and coverage requirements for this repo"
domain: "testing"
confidence: "high"
source: "codebase"
---

## Context
All tests use vitest with the fork pool (`maxWorkers=1`). Tests live in `src/tests/`. Coverage
targets: 80% for `src/services/` and `src/server/`. Constitution rule Q-1: every exported
function/handler must have a unit test. Q-6: 5s timeout per test.

## Patterns

### Test File Location
```
src/tests/
  unit/          — pure function tests (no I/O)
  integration/   — handler smoke tests with real Index
  conformance/   — registry conformance, schema alignment
```

### Vitest Test Structure
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('myHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns expected result for valid input', async () => {
    const result = await myHandler({ param: 'value' });
    expect(result.content[0].type).toBe('text');
  });

  it('throws on invalid input', async () => {
    await expect(myHandler({ param: null })).rejects.toThrow();
  });
});
```

### Mocking IndexContext
```typescript
import { vi } from 'vitest';
vi.mock('../services/IndexContext.js', () => ({
  getIndexContext: vi.fn().mockResolvedValue({
    ensureLoaded: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
    getById: vi.fn().mockReturnValue(undefined),
    writeEntry: vi.fn(),
    invalidate: vi.fn(),
  }),
}));
```

### Smoke Tests (Q-7, Q-8)
For dispatcher/handler smoke tests, invoke via the MCP dispatch schema only (not internal APIs):
```typescript
import { callTool } from '../server/registry.js';
const result = await callTool('my_tool_name', { param: 'value' });
expect(result).toMatchObject({ content: expect.any(Array) });
```

### Conformance Tests
Use `src/tests/toolRegistryConformance.spec.ts` as reference. New tools must appear in:
1. `INPUT_SCHEMAS` map
2. `STABLE` or `MUTATION` set (mutually exclusive)
3. `TOOL_TIERS` map

### Running Tests
```bash
npm test                  # all tests
npm run coverage          # with coverage report
npx vitest run --reporter=verbose  # verbose output
```

## Key Files
- `vitest.config.ts` — runner config (fork pool, maxWorkers=1, 5s timeout)
- `src/tests/toolRegistryConformance.spec.ts` — 10 conformance tests
- `src/tests/toolHandlerSmoke.spec.ts` — 34 smoke tests

## Anti-Patterns
- Never skip `vi.clearAllMocks()` in `beforeEach` — state leaks between tests
- Never exceed 5s per test — flag slow tests for refactoring (Q-6)
- Never test internal implementation details — test via public API only (Q-8)
- Never write integration tests that write to production data dirs — always use tmp fixtures
