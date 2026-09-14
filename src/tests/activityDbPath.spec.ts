/**
 * activityDbPath.spec.ts — the activity DB must not live at a cwd-relative path.
 *
 * Regression for the "Catalog Activity is permanently all-zero" bug.
 *
 * index-server runs as an MCP stdio server, so it inherits the working
 * directory of whichever client spawned it. When the activity database resolved
 * to `path.join(process.cwd(), 'metrics', 'activity.db')`, every client that
 * launched a server got a private database inside that client's own project
 * folder. Telemetry was therefore sharded by spawn directory: the instance
 * serving the dashboard read one file while the instances performing mutations
 * wrote to others.
 *
 * After #577, all mutable state resolves under STATE_ROOT (OS user-data dir),
 * not INSTALL_ROOT or CWD. This suite verifies that contract.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { resolveDbPath } from '../services/activityLog.js';
import { STATE_ROOT } from '../config/configUtils.js';

describe('activity database path resolution', () => {
  const originalCwd = process.cwd();
  const saved = {
    db: process.env.INDEX_SERVER_ACTIVITY_DB,
    metrics: process.env.INDEX_SERVER_METRICS_DIR,
  };

  beforeEach(() => {
    delete process.env.INDEX_SERVER_ACTIVITY_DB;
    delete process.env.INDEX_SERVER_METRICS_DIR;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (saved.db === undefined) delete process.env.INDEX_SERVER_ACTIVITY_DB;
    else process.env.INDEX_SERVER_ACTIVITY_DB = saved.db;
    if (saved.metrics === undefined) delete process.env.INDEX_SERVER_METRICS_DIR;
    else process.env.INDEX_SERVER_METRICS_DIR = saved.metrics;
  });

  it('resolves to the same file regardless of the working directory', () => {
    const fromRepo = resolveDbPath();

    process.chdir(path.parse(originalCwd).root);
    const fromElsewhere = resolveDbPath();

    expect(fromElsewhere).toBe(fromRepo);
  });

  it('does not place the database under the current working directory', () => {
    process.chdir(path.parse(originalCwd).root);
    const resolved = resolveDbPath();

    expect(resolved).not.toBe(path.join(process.cwd(), 'metrics', 'activity.db'));
  });

  it('anchors to STATE_ROOT/metrics by default', () => {
    const resolved = resolveDbPath();

    expect(path.basename(resolved)).toBe('activity.db');
    expect(path.basename(path.dirname(resolved))).toBe('metrics');
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe(path.join(STATE_ROOT, 'metrics', 'activity.db'));
  });

  it('honours an explicit INDEX_SERVER_ACTIVITY_DB override', () => {
    const target = path.resolve(path.parse(originalCwd).root, 'custom', 'act.db');
    process.env.INDEX_SERVER_ACTIVITY_DB = target;

    expect(resolveDbPath()).toBe(target);
  });

  it('returns an absolute path even when the override is relative', () => {
    process.env.INDEX_SERVER_ACTIVITY_DB = 'rel/act.db';

    expect(path.isAbsolute(resolveDbPath())).toBe(true);
  });

  it('honours INDEX_SERVER_METRICS_DIR when no explicit DB is set', () => {
    const dir = path.resolve(path.parse(originalCwd).root, 'metrics-elsewhere');
    process.env.INDEX_SERVER_METRICS_DIR = dir;

    expect(resolveDbPath()).toBe(path.join(dir, 'activity.db'));
  });

  it('prefers the explicit DB override over the metrics directory', () => {
    const db = path.resolve(path.parse(originalCwd).root, 'explicit', 'act.db');
    process.env.INDEX_SERVER_ACTIVITY_DB = db;
    process.env.INDEX_SERVER_METRICS_DIR = path.resolve(path.parse(originalCwd).root, 'ignored');

    expect(resolveDbPath()).toBe(db);
  });
});

/**
 * Subprocess tests: STATE_ROOT must resolve consistently regardless of the
 * spawning directory. Module-level constants are evaluated at import time, so
 * in-process chdir cannot distinguish STATE_ROOT-from-homedir vs
 * STATE_ROOT-from-cwd. A child process that starts elsewhere is the only
 * reliable check.
 */
describe('STATE_ROOT anchoring (subprocess: real foreign cwd)', () => {
  const distRoot = path.resolve(__dirname, '..', '..', 'dist');
  const foreignCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'state-root-'));

  afterAll(() => fs.rmSync(foreignCwd, { recursive: true, force: true }));

  function inForeignCwd(expr: string, extraEnv: Record<string, string> = {}): string {
    expect(
      fs.existsSync(path.join(distRoot, 'config', 'configUtils.js')),
      'dist/ is missing — run `npm run build` before this suite (pretest normally does)',
    ).toBe(true);

    return execFileSync(process.execPath, ['-e', `process.stdout.write(String(${expr}))`], {
      cwd: foreignCwd,
      encoding: 'utf8',
      env: { ...process.env, INDEX_SERVER_LOG_FILE: '0', INDEX_SERVER_ACTIVITY_LOG: '0', ...extraEnv },
    }).trim();
  }

  const cfg = () => `require(${JSON.stringify(path.join(distRoot, 'config', 'configUtils.js'))})`;

  it('STATE_ROOT does not follow a foreign working directory', () => {
    const root = inForeignCwd(`${cfg()}.STATE_ROOT`);

    expect(root).not.toBe(foreignCwd);
    expect(path.isAbsolute(root)).toBe(true);
  });

  it('STATE_ROOT resolves to the OS user-data directory', () => {
    const root = inForeignCwd(`${cfg()}.STATE_ROOT`);

    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      expect(root).toBe(path.join(localAppData, 'index-server'));
    } else {
      const xdgState = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
      expect(root).toBe(path.join(xdgState, 'index-server'));
    }
  });

  it('honours INDEX_SERVER_STATE_ROOT override from a foreign cwd', () => {
    const customRoot = path.join(foreignCwd, 'custom-state');
    const root = inForeignCwd(`${cfg()}.STATE_ROOT`, { INDEX_SERVER_STATE_ROOT: customRoot });

    expect(root).toBe(customRoot);
  });

  it('resolves the log file into STATE_ROOT, not the spawning project', () => {
    const logPath = inForeignCwd(
      `${cfg()}.toStateAbsolute(undefined, require('path').join('logs','mcp-server.log'))`,
    );

    const stateRoot = inForeignCwd(`${cfg()}.STATE_ROOT`);

    expect(logPath.startsWith(foreignCwd)).toBe(false);
    // Full-path assertion, matching the activity-DB case below. Basename plus
    // basename-of-dirname passes for ANY `<root>/logs/mcp-server.log`, so it
    // stays green if the site regresses from toStateAbsolute to
    // toInstallAbsolute — which is the exact regression this test exists to
    // catch.
    expect(path.resolve(logPath)).toBe(path.resolve(stateRoot, 'logs', 'mcp-server.log'));
  });

  it('resolves the activity database into STATE_ROOT', () => {
    const dbPath = inForeignCwd(
      `${JSON.stringify(path.join(distRoot, 'services', 'activityLog.js'))} && ` +
        `require(${JSON.stringify(path.join(distRoot, 'services', 'activityLog.js'))}).resolveDbPath()`,
    );
    const stateRoot = inForeignCwd(`${cfg()}.STATE_ROOT`);

    expect(dbPath.startsWith(foreignCwd)).toBe(false);
    expect(path.resolve(dbPath)).toBe(path.resolve(stateRoot, 'metrics', 'activity.db'));
  });

  it('still honours an absolute override from a foreign cwd', () => {
    const abs = path.join(foreignCwd, 'explicit.db');
    const out = execFileSync(
      process.execPath,
      ['-e', `process.stdout.write(require(${JSON.stringify(path.join(distRoot, 'services', 'activityLog.js'))}).resolveDbPath())`],
      {
        cwd: foreignCwd,
        encoding: 'utf8',
        env: { ...process.env, INDEX_SERVER_LOG_FILE: '0', INDEX_SERVER_ACTIVITY_DB: abs },
      },
    ).trim();

    expect(out).toBe(abs);
  });
});
