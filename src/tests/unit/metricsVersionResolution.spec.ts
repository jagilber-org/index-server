import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { findPackageVersion } from '../../utils/version';

const REPO_ROOT = process.cwd();
const REAL_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')
).version as string;

let tmpCwd: string;

beforeEach(() => {
  tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-version-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  try { fs.rmSync(tmpCwd, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('#559 findPackageVersion resolution order', () => {
  it('sanity: the real package version is a non-zero semver', () => {
    expect(REAL_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(REAL_VERSION).not.toBe('0.0.0');
  });

  it('resolves via self-location walk even when cwd has no package.json', () => {
    vi.spyOn(process, 'cwd').mockReturnValue(tmpCwd);
    const resolved = findPackageVersion(path.join(REPO_ROOT, 'src', 'services'));
    expect(resolved).toBe(REAL_VERSION);
  });

  it('prefers self-location over cwd when both have package.json (#559 regression)', () => {
    const SENTINEL_VERSION = '9.9.9';
    fs.writeFileSync(
      path.join(tmpCwd, 'package.json'),
      JSON.stringify({ name: 'sentinel-cwd-package', version: SENTINEL_VERSION })
    );
    vi.spyOn(process, 'cwd').mockReturnValue(tmpCwd);

    const resolved = findPackageVersion(path.join(REPO_ROOT, 'src', 'services'));

    expect(resolved).toBe(REAL_VERSION);
    expect(
      resolved,
      'the cwd candidate must not outrank the self-location candidate'
    ).not.toBe(SENTINEL_VERSION);
  });

  it('WARNs at default severity when no candidate resolves (OB-5)', () => {
    vi.spyOn(process, 'cwd').mockReturnValue(tmpCwd);
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    const resolved = findPackageVersion(tmpCwd);

    expect(resolved).toBe('0.0.0');
    const warn = written.find(l => l.includes('could not resolve package version'));
    expect(warn, 'a WARN line must be emitted rather than silently degrading').toBeDefined();
    expect(JSON.parse(warn as string).level).toBe('WARN');
  });
});

describe('#559 version validation', () => {
  it('rejects non-string version values', () => {
    const badDir = path.join(tmpCwd, 'bad-obj');
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(
      path.join(badDir, 'package.json'),
      JSON.stringify({ name: 'bad', version: { major: 1 } })
    );
    vi.spyOn(process, 'cwd').mockReturnValue(badDir);

    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    const resolved = findPackageVersion(badDir);
    expect(resolved).toBe('0.0.0');
  });

  it('rejects version strings exceeding 100 characters', () => {
    const longDir = path.join(tmpCwd, 'long-ver');
    fs.mkdirSync(longDir, { recursive: true });
    fs.writeFileSync(
      path.join(longDir, 'package.json'),
      JSON.stringify({ name: 'long', version: 'a'.repeat(101) })
    );
    vi.spyOn(process, 'cwd').mockReturnValue(longDir);

    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    const resolved = findPackageVersion(longDir);
    expect(resolved).toBe('0.0.0');
  });

  it('accepts valid short version strings', () => {
    const goodDir = path.join(tmpCwd, 'good');
    fs.mkdirSync(goodDir, { recursive: true });
    fs.writeFileSync(
      path.join(goodDir, 'package.json'),
      JSON.stringify({ name: 'good', version: '1.2.3-beta.1' })
    );
    vi.spyOn(process, 'cwd').mockReturnValue(goodDir);

    const resolved = findPackageVersion(goodDir);
    expect(resolved).toBe('1.2.3-beta.1');
  });
});

describe('#559 bounded upward walk', () => {
  it('finds package.json at depth > 2 from callerDirname', () => {
    fs.writeFileSync(
      path.join(tmpCwd, 'package.json'),
      JSON.stringify({ name: 'walk-test', version: '3.3.3' })
    );

    const deepDir = path.join(tmpCwd, 'a', 'b', 'c');
    fs.mkdirSync(deepDir, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(tmpCwd);

    const resolved = findPackageVersion(deepDir);
    expect(resolved).toBe('3.3.3');
  });
});

describe('#524 health_check reports a resolved version', () => {
  it('reports the real version even when cwd is not the package root', async () => {
    vi.resetModules();
    vi.spyOn(process, 'cwd').mockReturnValue(tmpCwd);

    await import('../../services/handlers.metrics.js');
    const { getHandler } = await import('../../server/registry.js');

    const handler = getHandler('health_check');
    expect(handler, 'health_check must be registered').toBeTruthy();

    const result = await handler!({}) as { version?: string };
    expect(result.version).toBe(REAL_VERSION);
    expect(result.version).not.toBe('0.0.0');
  });
});
