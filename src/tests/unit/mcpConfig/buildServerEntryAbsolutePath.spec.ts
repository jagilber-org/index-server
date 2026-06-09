/**
 * Regression: `buildServerEntry` must emit an ABSOLUTE node entry path for
 * every non-workspace client format (`vscode-global`, `copilot-cli`, `claude`).
 *
 * Root cause (setup-wizard RCA): `resolveServerLaunch` returns the local launch
 * descriptor with a RELATIVE `args[0]` (`dist/server/index-server.js`) plus a
 * `cwd` of the install root. Only the repo-scoped `vscode` format carries that
 * `cwd` through. For `copilot-cli` and `claude` the launching client's working
 * directory is the user's home (e.g. `C:\Users\<name>`), and those clients do
 * not reliably honor a `cwd` field — so a relative path is unlaunchable
 * ("Cannot find module dist/server/index-server.js"). `copilot --yolo` failed
 * silently because of exactly this.
 *
 * The previous test suite missed this because it executes from the repo root
 * (which DOES contain `dist/`), so a relative-no-cwd path resolved by accident.
 * This unit test mocks the filesystem so the install root differs from the test
 * cwd and pins the absolute-path contract per format.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

import { buildServerEntry } from '../../../services/mcpConfig/formats';
import type { ServerBuildConfig } from '../../../services/mcpConfig/formats';
import type { McpDataPaths } from '../../../services/mcpConfig/flagCatalog';
import { toForwardSlashes } from '../../../services/mcpConfig/flagCatalog';

// A synthetic install root that is NOT the test process cwd, so a relative
// entry path could never resolve "by accident".
const INSTALL_ROOT = path.resolve(path.sep === '\\' ? 'C:\\opt\\index-server' : '/opt/index-server');
const ENTRY_RELATIVE = path.join('dist', 'server', 'index-server.js');
const EXPECTED_ABS = toForwardSlashes(path.join(INSTALL_ROOT, ENTRY_RELATIVE));

function makeConfig(): ServerBuildConfig {
  return {
    serverName: 'index-server',
    profile: 'enhanced',
    root: INSTALL_ROOT,
    port: 7777,
    host: '127.0.0.1',
    tls: false,
    mutation: true,
    logLevel: 'info',
  } as ServerBuildConfig;
}

function makePaths(): McpDataPaths {
  const under = (p: string): string => path.join(INSTALL_ROOT, p);
  return {
    instructions: under('instructions'),
    feedback: under('feedback'),
    backups: under('backups'),
    state: under('state'),
    auditLog: under('logs/audit.log'),
    logFile: under('logs/server.log'),
    metrics: under('metrics'),
    messaging: under('messaging'),
    embeddings: under('embeddings'),
    modelCache: under('model-cache'),
    sqliteDb: under('index.db'),
    certs: under('certs'),
    flags: under('flags.json'),
  };
}

describe('buildServerEntry — absolute node entry path per client format', () => {
  beforeEach(() => {
    // Force the `local` launch source: report the install-root entry-point as
    // present so `resolveServerLaunch` returns the relative-args descriptor.
    vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike): boolean => {
      return path.resolve(String(p)) === path.join(INSTALL_ROOT, ENTRY_RELATIVE);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('copilot-cli emits an absolute entry path (no client cwd to anchor a relative path)', () => {
    const entry = buildServerEntry('copilot-cli', makeConfig(), makePaths());
    expect(path.isAbsolute(entry.args[0])).toBe(true);
    expect(entry.args[0]).toBe(EXPECTED_ABS);
    // copilot-cli relies solely on the absolute args path.
    expect(entry.cwd).toBeUndefined();
  });

  it('claude emits an absolute entry path', () => {
    const entry = buildServerEntry('claude', makeConfig(), makePaths());
    expect(path.isAbsolute(entry.args[0])).toBe(true);
    expect(entry.args[0]).toBe(EXPECTED_ABS);
    expect(entry.cwd).toBeUndefined();
  });

  it('vscode-global emits an absolute entry path AND a cwd', () => {
    const entry = buildServerEntry('vscode-global', makeConfig(), makePaths());
    expect(path.isAbsolute(entry.args[0])).toBe(true);
    expect(entry.args[0]).toBe(EXPECTED_ABS);
    expect(entry.cwd).toBe(toForwardSlashes(INSTALL_ROOT));
  });

  it('vscode (workspace) keeps a relative entry path anchored by cwd', () => {
    const entry = buildServerEntry('vscode', makeConfig(), makePaths());
    expect(path.isAbsolute(entry.args[0])).toBe(false);
    expect(entry.args[0]).toBe(toForwardSlashes(ENTRY_RELATIVE));
    expect(entry.cwd).toBe(toForwardSlashes(INSTALL_ROOT));
  });
});

/**
 * Regression: `buildServerEntry` must pin the `command` (the node binary) to an
 * ABSOLUTE path for every user-machine-local client format. A bare `node` is
 * resolved by the launching client against the PATH of its own process,
 * inherited at launch time — so a client started before Node was on PATH (or
 * from a launcher with a stripped environment) fails with "command 'node' not
 * found" even though `node` works in a fresh terminal. The repo-scoped `vscode`
 * (workspace) format keeps bare `node` so committed configs stay portable.
 */
describe('buildServerEntry — absolute node command per client format', () => {
  const EXPECTED_CMD = toForwardSlashes(process.execPath);

  beforeEach(() => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike): boolean => {
      return path.resolve(String(p)) === path.join(INSTALL_ROOT, ENTRY_RELATIVE);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['copilot-cli', 'claude', 'vscode-global'] as const)(
    '%s pins command to the absolute node binary (process.execPath)',
    (format) => {
      const entry = buildServerEntry(format, makeConfig(), makePaths());
      expect(path.isAbsolute(entry.command)).toBe(true);
      expect(entry.command).toBe(EXPECTED_CMD);
    },
  );

  it('vscode (workspace) keeps bare `node` for portability across machines', () => {
    const entry = buildServerEntry('vscode', makeConfig(), makePaths());
    expect(entry.command).toBe('node');
  });
});
