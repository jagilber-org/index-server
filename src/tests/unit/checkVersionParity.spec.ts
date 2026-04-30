/**
 * Tests for scripts/check-version-parity.mjs (issue #248).
 *
 * Verifies the standalone parity script:
 *   - Exits 0 when package.json and server.json versions agree.
 *   - Exits non-zero with a clear diagnostic when they diverge.
 *   - Reads from a custom --root for testability (so we can stage fixtures).
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-version-parity.mjs');

function stageRepo(version: { pkg: string; server: string; pkgEntries?: Record<string, string> }): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'parity-'));
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: '@x/y', version: version.pkg }, null, 2),
    'utf8'
  );
  const packages = Object.entries(version.pkgEntries ?? { default: version.server }).map(
    ([id, v]) => ({ identifier: id, version: v })
  );
  writeFileSync(
    path.join(dir, 'server.json'),
    JSON.stringify({ name: '@x/y', version: version.server, packages }, null, 2),
    'utf8'
  );
  return dir;
}

function runScript(root: string) {
  return spawnSync(process.execPath, [SCRIPT, '--root', root], {
    encoding: 'utf8',
  });
}

describe('check-version-parity.mjs', () => {
  it('exits 0 when package.json and server.json versions match', () => {
    const dir = stageRepo({ pkg: '1.2.3', server: '1.2.3' });
    try {
      const r = runScript(dir);
      expect(r.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits non-zero when top-level versions diverge', () => {
    const dir = stageRepo({ pkg: '1.2.3', server: '1.2.4' });
    try {
      const r = runScript(dir);
      expect(r.status).not.toBe(0);
      const out = (r.stderr || '') + (r.stdout || '');
      expect(out).toMatch(/version/i);
      expect(out).toContain('1.2.3');
      expect(out).toContain('1.2.4');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits non-zero when a server.json packages[].version diverges', () => {
    const dir = stageRepo({
      pkg: '1.2.3',
      server: '1.2.3',
      pkgEntries: { '@x/y': '1.2.0' },
    });
    try {
      const r = runScript(dir);
      expect(r.status).not.toBe(0);
      const out = (r.stderr || '') + (r.stdout || '');
      expect(out).toMatch(/packages/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 against the real repo (sanity)', () => {
    const r = runScript(REPO_ROOT);
    expect(r.status).toBe(0);
  });
});
