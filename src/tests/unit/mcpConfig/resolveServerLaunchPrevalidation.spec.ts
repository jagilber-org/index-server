/**
 * Pre-validation of resolved entry-point in `resolveServerLaunch`.
 *
 * Issue: https://github.com/jagilber-dev/index-server/issues/386
 *
 * TDD RED phase (TS-8 / TS-9). These tests pin the contract that the setup
 * wizard MUST validate the resolved launch target before baking it into
 * `mcp.json`. Today's implementation:
 *
 *   - Checks `fs.existsSync` for the local + packaged entry-point files
 *     (good — happy path & first-level fallback already work).
 *   - Falls through to `{ command: 'npx', args: ['-y', '@jagilber-org/index-server'] }`
 *     UNCONDITIONALLY when neither file exists — even when `npx` itself is
 *     unreachable (offline machine, stripped PATH, locked-down CI runner).
 *
 * Per issue #386 the wizard must instead:
 *   1. Validate the resolved entry-point exists before writing `mcp.json`.
 *   2. Fall back local → packaged → npx, checking each candidate.
 *   3. If ALL three candidates are non-viable, throw a clear, actionable
 *      error that names the candidate path(s) tried and gives the user a
 *      concrete next step (build / reinstall / repair PATH).
 *
 * Trinity implements the production fix; these tests must fail today.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import child_process from 'child_process';

import { resolveServerLaunch } from '../../../services/mcpConfig/formats';

// The package root that `resolveServerLaunch` derives via `__dirname`.
// `__dirname` inside formats.ts → src/services/mcpConfig, so packageRoot is repo root.
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const ENTRY_RELATIVE = path.join('dist', 'server', 'index-server.js');

interface ExistsMap {
  [absolutePath: string]: boolean;
}

function installFsExistsMock(map: ExistsMap): void {
  // Default: every path the resolver asks about is reported missing unless
  // explicitly listed as present. This gives each test a clean slate.
  vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike): boolean => {
    const key = path.resolve(String(p));
    return map[key] === true;
  });
}

describe('resolveServerLaunch — entry-point pre-validation (issue #386)', () => {
  let originalPath: string | undefined;
  let originalPathExt: string | undefined;

  beforeEach(() => {
    originalPath = process.env.PATH;
    originalPathExt = process.env.PATHEXT;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
    if (originalPathExt === undefined) delete process.env.PATHEXT; else process.env.PATHEXT = originalPathExt;
  });

  it('happy path: returns source=local when the local entry-point file exists', () => {
    const tmpRoot = path.resolve('/tmp/fake-local-root-issue386');
    const localEntry = path.join(tmpRoot, ENTRY_RELATIVE);
    installFsExistsMock({ [localEntry]: true });

    const launch = resolveServerLaunch({ root: tmpRoot });

    expect(launch.source).toBe('local');
    expect(launch.command).toBe('node');
    expect(launch.cwd).toBe(tmpRoot);
    expect(launch.args[0]).toBe(ENTRY_RELATIVE.replace(/\\/g, '/'));
  });

  it('falls back to packaged when the local dist is missing but packaged dist exists', () => {
    const tmpRoot = path.resolve('/tmp/fake-no-local-root-issue386');
    const packagedEntry = path.join(PACKAGE_ROOT, ENTRY_RELATIVE);
    installFsExistsMock({ [packagedEntry]: true });

    const launch = resolveServerLaunch({ root: tmpRoot });

    expect(launch.source).toBe('packaged');
    expect(launch.command).toBe('node');
    // Resolved arg MUST point at the file that fs.existsSync reported as
    // present. This is the core pre-validation invariant.
    expect(path.resolve(launch.args[0])).toBe(packagedEntry);
  });

  it('falls back to npx when local + packaged dists are both missing AND npx is reachable on PATH', () => {
    const tmpRoot = path.resolve('/tmp/fake-no-dist-root-issue386');
    installFsExistsMock({});
    // Leave PATH intact; on every developer + CI host npx ships with node.

    const launch = resolveServerLaunch({ root: tmpRoot });

    expect(launch.source).toBe('npx');
    expect(launch.command).toBe('npx');
    expect(launch.args).toEqual(['-y', '@jagilber-org/index-server']);
  });

  it('throws an actionable error when local + packaged dists are missing AND npx is NOT reachable', () => {
    const tmpRoot = path.resolve('/tmp/fake-all-three-missing-issue386');
    const localEntry = path.join(tmpRoot, ENTRY_RELATIVE);
    const packagedEntry = path.join(PACKAGE_ROOT, ENTRY_RELATIVE);
    installFsExistsMock({});

    // Render npx unreachable from the wizard's PoV. The fix may detect this
    // via PATH lookup or via spawnSync('npx --version') — both should fail.
    process.env.PATH = '';
    if (process.platform === 'win32') process.env.PATHEXT = '';
    vi.spyOn(child_process, 'spawnSync').mockReturnValue({
      pid: -1,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from('not found'),
      status: 127,
      signal: null,
    } as ReturnType<typeof child_process.spawnSync>);

    let caught: unknown;
    try {
      resolveServerLaunch({ root: tmpRoot });
    } catch (err) {
      caught = err;
    }

    expect(caught, 'resolveServerLaunch must throw when no launch mode is viable').toBeInstanceOf(Error);
    const message = (caught as Error).message;
    // Must name at least one candidate path the wizard tried — otherwise the
    // user has no breadcrumb back to the broken file.
    const mentionsLocal = message.includes(localEntry) || message.includes(localEntry.replace(/\\/g, '/'));
    const mentionsPackaged = message.includes(packagedEntry) || message.includes(packagedEntry.replace(/\\/g, '/'));
    expect(mentionsLocal || mentionsPackaged,
      `error message must name a candidate path (got: ${message})`).toBe(true);
    // Must give a concrete remediation hint.
    expect(message).toMatch(/npm (install|run build)|--root|reinstall|build|npx/i);
  });

  it('verifies the resolved entry-point file exists at resolve time (pre-write invariant)', () => {
    // Simulate the regression directly: a stale/partial deploy where the
    // local `dist/` directory was created but the entry-point file is
    // missing. Today, the resolver's `fs.existsSync(localEntry)` check
    // already prevents this — we lock it in so the fix cannot regress it.
    const tmpRoot = path.resolve('/tmp/fake-partial-dist-issue386');
    const localEntry = path.join(tmpRoot, ENTRY_RELATIVE);
    const localDistDir = path.join(tmpRoot, 'dist');
    const packagedEntry = path.join(PACKAGE_ROOT, ENTRY_RELATIVE);
    // dist/ dir exists but the entry-point JS does NOT. Packaged also missing.
    installFsExistsMock({ [localDistDir]: true });

    process.env.PATH = '';
    if (process.platform === 'win32') process.env.PATHEXT = '';
    vi.spyOn(child_process, 'spawnSync').mockReturnValue({
      pid: -1,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from('not found'),
      status: 127,
      signal: null,
    } as ReturnType<typeof child_process.spawnSync>);

    let caught: unknown;
    let launch: ReturnType<typeof resolveServerLaunch> | undefined;
    try {
      launch = resolveServerLaunch({ root: tmpRoot });
    } catch (err) {
      caught = err;
    }

    // The resolver must NOT silently fall through to npx when a) the local
    // dist dir hints at a broken install, b) packaged is absent, and c) npx
    // is unreachable. It must throw and name the missing entry-point.
    expect(caught, 'partial-dist + no npx must throw, not silently return npx').toBeInstanceOf(Error);
    if (launch !== undefined) {
      // Defensive guard in case the implementation chooses to return a
      // descriptor: the args[0] must point at a file that actually exists.
      const resolvedArg = path.isAbsolute(launch.args[0])
        ? launch.args[0]
        : path.resolve(launch.cwd ?? tmpRoot, launch.args[0]);
      // fs.existsSync is mocked — only the entries in the map are "present".
      expect(fs.existsSync(resolvedArg)).toBe(true);
    }
    if (caught instanceof Error) {
      expect(caught.message).toContain(localEntry.split(path.sep).slice(-2).join(path.sep).replace(/\\/g, '/').split('/').slice(-1)[0]);
    }
  });
});
