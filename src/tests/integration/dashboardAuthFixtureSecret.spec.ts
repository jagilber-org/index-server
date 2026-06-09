/**
 * Meta-regression test for issue #352 alert #46 (secret-scanning generic-api-key).
 *
 * Origin: 15-alert security wave on jagilber-org/index-server mirror.
 * Owner: Tank (Tester).
 *
 * Constitution refs:
 *   TS-8 / TS-9 / TS-12
 *
 * Purpose
 * -------
 * Issue #352 alert #46 fired on the literal value
 *   ['integration', 'test', 'admin', 'key', '42'].join('-')
 *   === 'integration-test-admin-key-42'
 * in src/tests/integration/dashboardAuth.spec.ts line 103. The fixture has
 * been rotated to a clearly-fake `sk-test-FAKE-<runtime-suffix>` pattern.
 *
 * This suite locks the new contract so the fixture cannot silently drift
 * back to a detector-tripping shape. Any future edit that:
 *   - drops the sk-test-FAKE- prefix
 *   - reintroduces a static joined-keyword pattern
 *   - removes the runtime suffix
 * will fail this test.
 *
 * Per TS-12 we provide >=5 cases.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SPEC_PATH = path.resolve(__dirname, 'dashboardAuth.spec.ts');
const SRC = fs.readFileSync(SPEC_PATH, 'utf8');

// Extract the ADMIN_KEY declaration line(s)
const ADMIN_KEY_DECL_MATCH = SRC.match(/const\s+ADMIN_KEY\s*=\s*([^;]+);/);

describe('#352 alert #46 — admin-key test fixture must remain clearly-fake', () => {
  it('declares ADMIN_KEY (sanity check the test target still exists)', () => {
    expect(ADMIN_KEY_DECL_MATCH, 'expected `const ADMIN_KEY = ...;` in dashboardAuth.spec.ts').toBeTruthy();
  });

  it('does NOT use the old detector-tripping literal', () => {
    expect(SRC).not.toContain("['integration', 'test', 'admin', 'key', '42'].join");
    expect(SRC).not.toContain('integration-test-admin-key-42');
  });

  it('uses the canonical sk-test-FAKE- prefix in the declaration', () => {
    expect(ADMIN_KEY_DECL_MATCH![1], 'declaration must contain sk-test-FAKE-').toMatch(/sk-test-FAKE-/);
  });

  it('uses a runtime-generated suffix (not a hard-coded literal)', () => {
    // Must reference at least one runtime/dynamic source — process.pid,
    // Date.now(), randomBytes, etc. — so the value is not a static string.
    const decl = ADMIN_KEY_DECL_MATCH![1];
    expect(decl, 'must reference runtime entropy/identity (e.g. process.pid, Date.now, randomBytes)').toMatch(
      /process\.pid|Date\.now|randomBytes|randomUUID/
    );
  });

  it('carries an explanatory comment + suppression marker', () => {
    // The line(s) immediately preceding the declaration must explain why this
    // is safe (per repo PII-scan & secret-scan hygiene). Check for either the
    // allowlist pragma OR nosec marker AND the #352 reference.
    const declIdx = SRC.indexOf('const ADMIN_KEY');
    const preamble = SRC.slice(Math.max(0, declIdx - 800), declIdx + 400);
    expect(preamble, 'must reference issue #352').toMatch(/#352/);
    expect(preamble, 'must carry pragma:allowlist or nosec marker').toMatch(/allowlist secret|nosec/i);
  });

  it('runtime value matches the sk-test-FAKE-<suffix> shape', async () => {
    // Sanity-load the fixture expression by evaluating it. We re-derive the
    // same expression here using the same runtime inputs to keep the test
    // self-contained — if the declaration source matches the canonical
    // shape and uses process.pid/Date.now, the rendered value will start
    // with sk-test-FAKE- and have a non-empty suffix.
    const decl = ADMIN_KEY_DECL_MATCH![1].trim();
    // Strip an optional trailing line comment ("// nosec ...") from the value
    const declValue = decl.replace(/\s*\/\/[^\n]*$/, '').trim();
    // Evaluate in an isolated function with controlled globals
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const value = new Function('process', `return (${declValue});`)(process) as string;
    expect(typeof value).toBe('string');
    expect(value.startsWith('sk-test-FAKE-'), `expected sk-test-FAKE- prefix, got "${value}"`).toBe(true);
    expect(value.length).toBeGreaterThan('sk-test-FAKE-'.length + 2);
  });

  it('shape is detector-resistant — does not match the generic-api-key heuristic family', () => {
    // The generic-api-key detector looks for high-entropy contiguous tokens
    // assigned to *_KEY / *_TOKEN / *_SECRET variables. Our shape (1) wears a
    // clearly-fake brand prefix, (2) splits entropy across formatted runtime
    // sources rather than a single opaque token. Verify it does not match
    // patterns like /[a-z0-9]{32,}/ — a common detector heuristic.
    const decl = ADMIN_KEY_DECL_MATCH![1].trim().replace(/\s*\/\/[^\n]*$/, '');
    // Reject if a 32+ char contiguous alphanumeric literal appears
    expect(decl, 'must not contain a 32+ char contiguous alphanumeric literal').not.toMatch(
      /['"`][A-Za-z0-9+/_-]{32,}['"`]/
    );
  });
});
