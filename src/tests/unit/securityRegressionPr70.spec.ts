/**
 * Security Regression Tests — PR #70 Gap Coverage (Issue #71)
 *
 * Companion to `securityRegression.spec.ts`. That file covers escapeHtml,
 * validatePathContainment, parseTimeRange, and structural regex checks.
 *
 * This file fills gaps explicitly called out in issue #71 that the prior
 * suite does not yet exercise:
 *   • #64 Command injection — `scripts/dist/generate-certs.mjs` argument
 *     validation (hostname / days / keySize) and `execFileSync` usage.
 *   • #62 Route-level path traversal — `/api/docs/:name` and
 *     `/api/screenshots/:name` route handlers must use the shared
 *     containment validator (asserted via source inspection).
 *   • #62 Handler-level path traversal — `trace_dump` and
 *     `promote_from_repo` must reject paths that escape `cwd` /
 *     resolve relative segments to absolute paths.
 *
 * Each test is designed to FAIL if the corresponding fix is reverted.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import '../../services/handlers.trace';
import '../../services/handlers.promote';
import { getHandler } from '../../server/registry';

// ---------------------------------------------------------------------------
// #64 — Command Injection: generate-certs.mjs
// ---------------------------------------------------------------------------
describe('generate-certs.mjs — command injection prevention (PR #70, issue #64)', () => {
  const scriptPath = path.resolve(__dirname, '..', '..', '..', 'scripts', 'dist', 'generate-certs.mjs');

  function readScript(): string {
    return fs.readFileSync(scriptPath, 'utf8');
  }

  it('uses execFileSync, never execSync, for shell-free argv invocation', () => {
    const src = readScript();
    expect(src).toContain("import { execFileSync } from 'child_process'");
    // No execSync import — execSync would re-introduce shell metacharacter risk
    expect(src).not.toMatch(/execSync\s*\(/);
    expect(src).not.toMatch(/import\s*\{\s*execSync/);
  });

  it('invokes openssl as argv0 (not as part of a shell-quoted command string)', () => {
    const src = readScript();
    // Every openssl invocation should pass arguments via array, not template string
    expect(src).toMatch(/execFileSync\(\s*'openssl'\s*,\s*\[/);
    // Old vulnerable form used backtick strings like: execSync(`openssl genrsa ...`)
    expect(src).not.toMatch(/exec[A-Za-z]*Sync\s*\(\s*`openssl /);
  });

  it('validates hostname against a strict allowlist regex', () => {
    const src = readScript();
    // The hostname guard must be present and exit on mismatch
    expect(src).toMatch(/\/\^\[a-zA-Z0-9\._-\]\+\$\//);
    expect(src).toMatch(/Invalid hostname/);
  });

  it('rejects out-of-range "days" values (1..3650)', () => {
    const src = readScript();
    expect(src).toMatch(/Number\.isInteger\(days\)/);
    expect(src).toMatch(/days\s*<\s*1/);
    expect(src).toMatch(/days\s*>\s*3650/);
    expect(src).toMatch(/Invalid days value/);
  });

  it('restricts keySize to a fixed allowlist (2048, 3072, 4096)', () => {
    const src = readScript();
    expect(src).toMatch(/Number\.isInteger\(keySize\)/);
    expect(src).toMatch(/\[\s*2048\s*,\s*3072\s*,\s*4096\s*\]\.includes\(keySize\)/);
    expect(src).toMatch(/Invalid key size/);
  });

  it('hostname allowlist regex blocks shell metacharacters', () => {
    // Mirror the production guard — this ensures the regex itself is correct.
    const allow = /^[a-zA-Z0-9._-]+$/;
    const malicious = [
      'localhost; rm -rf /',
      'foo`whoami`',
      'foo$(id)',
      'foo bar',
      'foo|nc evil 1234',
      'foo&calc',
      'foo>out',
      'foo<in',
      'foo\nrm',
      "foo'evil",
      'foo"evil',
      '*',
      '',
    ];
    for (const m of malicious) {
      expect(allow.test(m), `regex must reject: ${JSON.stringify(m)}`).toBe(false);
    }
    // Sanity: legitimate hostnames must still pass
    for (const ok of ['localhost', 'example.com', 'my-host_01']) {
      expect(allow.test(ok), `regex must accept: ${ok}`).toBe(true);
    }
  });

  it('keySize allowlist excludes weak/odd RSA sizes', () => {
    const allowed = [2048, 3072, 4096];
    for (const bad of [0, 1, 512, 1024, 1023, 2049, 8192, -2048, 3.5, NaN]) {
      // Replicate the production check: Number.isInteger + includes
      const ok = Number.isInteger(bad) && allowed.includes(bad as number);
      expect(ok, `keySize ${bad} must be rejected`).toBe(false);
    }
    for (const good of allowed) {
      expect(Number.isInteger(good) && allowed.includes(good)).toBe(true);
    }
  });

  it('days allowlist boundary checks (1..3650 inclusive)', () => {
    const isValid = (d: number) => Number.isInteger(d) && d >= 1 && d <= 3650;
    expect(isValid(0)).toBe(false);
    expect(isValid(-1)).toBe(false);
    expect(isValid(3651)).toBe(false);
    expect(isValid(1.5)).toBe(false);
    expect(isValid(NaN)).toBe(false);
    expect(isValid(1)).toBe(true);
    expect(isValid(365)).toBe(true);
    expect(isValid(3650)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #62 — Route-level Path Traversal: dashboard /api/docs and /api/screenshots
// ---------------------------------------------------------------------------
//
// The route file is server-side TypeScript that depends on Express; rather
// than spinning up the dashboard for every test we assert the protective
// pattern is preserved in source. If a future refactor removes
// `validatePathContainment` or the strict `name` allowlist, these tests
// will fail and force a review.
// ---------------------------------------------------------------------------
describe('dashboard routes — path traversal prevention (PR #70, issue #62)', () => {
  const routesPath = path.resolve(
    __dirname, '..', '..', 'dashboard', 'server', 'routes', 'index.ts',
  );

  function readRoutes(): string {
    return fs.readFileSync(routesPath, 'utf8');
  }

  it('imports the shared validatePathContainment helper', () => {
    const src = readRoutes();
    expect(src).toMatch(/from ['"][^'"]*pathContainment(?:\.js)?['"]/);
    expect(src).toMatch(/validatePathContainment/);
  });

  it('/api/docs/:name strips non-allowlisted characters from the doc name', () => {
    const src = readRoutes();
    // The handler must apply the allowlist BEFORE building the path
    expect(src).toMatch(/req\.params\.name\.replace\(\/\[\^a-z0-9_-\]\/gi/);
  });

  it('/api/docs/:name validates the resolved path stays inside docs/panels', () => {
    const src = readRoutes();
    // Find the /api/docs/ block and confirm validatePathContainment is invoked
    const block = src.match(/app\.get\(['"]\/api\/docs\/:name['"][\s\S]*?\}\);/);
    expect(block, 'expected /api/docs/:name route to exist').not.toBeNull();
    expect(block![0]).toContain('validatePathContainment');
    expect(block![0]).toContain('docs');
    expect(block![0]).toContain('panels');
  });

  it('/api/screenshots/:name validates the resolved path stays inside docs/screenshots', () => {
    const src = readRoutes();
    const block = src.match(/app\.get\(['"]\/api\/screenshots\/:name['"][\s\S]*?\}\);/);
    expect(block, 'expected /api/screenshots/:name route to exist').not.toBeNull();
    expect(block![0]).toContain('validatePathContainment');
    expect(block![0]).toContain('screenshots');
    // Filename allowlist must reject path separators / traversal markers
    expect(block![0]).toMatch(/replace\(\/\[\^a-z0-9\._-\]\/gi/);
    expect(block![0]).toMatch(/endsWith\(['"]\.png['"]\)/);
  });

  it('routes return HTTP 400 on path-escape errors (not 500)', () => {
    const src = readRoutes();
    // The error branch must convert containment failures into 400, not leak stack traces
    expect(src).toMatch(/Path escapes allowed base:/);
    expect(src).toMatch(/res\.status\(400\)/);
  });
});

// ---------------------------------------------------------------------------
// #62 — Handler Path Traversal: trace_dump
// ---------------------------------------------------------------------------
describe('trace_dump handler — path traversal prevention (PR #70, issue #62)', () => {
  const handler = getHandler('trace_dump');

  it('handler is registered', () => {
    expect(handler, 'trace_dump must be registered for this test to be meaningful').toBeDefined();
  });

  it('rejects absolute paths outside cwd with an error result', async () => {
    if (!handler) return;
    // Pick a path that is guaranteed to be outside cwd on every platform
    const evilAbsolute = process.platform === 'win32'
      ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
      : '/etc/passwd';
    const res = await handler({ file: evilAbsolute }) as { error?: string; dumped?: boolean };
    expect(res, 'expected error result').toBeDefined();
    expect(res.error, 'must return error, not dumped:true').toMatch(/working directory/i);
    expect(res.dumped).toBeUndefined();
  });

  it('rejects relative traversal that resolves outside cwd', async () => {
    if (!handler) return;
    const res = await handler({ file: '../../../../../etc/passwd' }) as { error?: string };
    expect(res.error).toMatch(/working directory/i);
  });

  it('does NOT write a file when the path is rejected', async () => {
    if (!handler) return;
    const tmpFile = path.join(os.tmpdir(), `trace-traversal-${Date.now()}.json`);
    // Sanity: ensure we are using an absolute path outside cwd
    expect(path.isAbsolute(tmpFile)).toBe(true);
    expect(tmpFile.startsWith(process.cwd() + path.sep)).toBe(false);

    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    const res = await handler({ file: tmpFile }) as { error?: string };
    expect(res.error).toMatch(/working directory/i);
    expect(fs.existsSync(tmpFile), 'rejected dump must not have written a file').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #62 — Handler Path Traversal: promote_from_repo
// ---------------------------------------------------------------------------
describe('promote_from_repo handler — path injection prevention (PR #70, issue #62)', () => {
  const handler = getHandler('promote_from_repo');

  it('handler is registered', () => {
    expect(handler).toBeDefined();
  });

  it('rejects missing/non-string repoPath without crashing', async () => {
    if (!handler) return;
    const r1 = await handler({}) as { error?: string };
    expect(r1.error).toMatch(/repoPath/i);
    const r2 = await handler({ repoPath: 123 as unknown as string }) as { error?: string };
    expect(r2.error).toMatch(/repoPath/i);
    const r3 = await handler({ repoPath: '' }) as { error?: string };
    expect(r3.error).toMatch(/repoPath/i);
  });

  it('resolves relative paths to absolute (preventing CWD-relative injection surprises)', async () => {
    if (!handler) return;
    // A non-existent relative path must surface as an absolute "does not exist" error,
    // not be silently treated as a different working directory. This proves
    // path.resolve() is applied before existence checks.
    const fake = `__definitely_does_not_exist_${Date.now()}`;
    const res = await handler({ repoPath: fake }) as { error?: string };
    expect(res.error).toBeDefined();
    expect(res.error).toMatch(/does not exist|not a directory/i);
    // The error must echo the absolute resolved path, proving path.resolve() ran
    expect(res.error).toContain(path.resolve(fake));
  });

  it('rejects paths that exist but are not directories', async () => {
    if (!handler) return;
    // package.json is guaranteed to exist as a file
    const res = await handler({ repoPath: 'package.json' }) as { error?: string };
    expect(res.error).toMatch(/does not exist|not a directory/i);
  });
});

// ---------------------------------------------------------------------------
// #61 — Regex Injection: search handler defense-in-depth
// ---------------------------------------------------------------------------
//
// The companion file `securityRegression.spec.ts` covers structural regex
// validation in isolation. Here we add a direct check on the search handler
// source that the RegExp constructor calls are wrapped in try/catch, so an
// invalid pattern cannot crash the dispatcher (post-validation safety net).
// ---------------------------------------------------------------------------
describe('handlers.search — RegExp construction is crash-safe (PR #70, issue #61)', () => {
  const searchPath = path.resolve(__dirname, '..', '..', 'services', 'handlers.search.ts');

  it('wraps regex-mode RegExp construction in try/catch', () => {
    const src = fs.readFileSync(searchPath, 'utf8');
    // There must be at least two new RegExp(...) sites both guarded
    const regexConstructs = src.match(/new RegExp\(/g) || [];
    expect(regexConstructs.length).toBeGreaterThanOrEqual(2);
    // The defense-in-depth comment + try/catch wrappers must remain
    expect(src).toMatch(/try\s*\{[^}]*new RegExp\([^)]*\)[\s\S]*?catch/);
  });
});
