/**
 * A persisted override must never be able to permanently brick the server.
 *
 * The overlay (`runtime-overrides.json`) is replayed into `process.env` on EVERY
 * boot, before any config is materialized. So a persisted value that makes
 * config parsing throw is not a one-off failure — it is permanent, it happens
 * during module evaluation before the MCP handshake (the client sees only
 * "server exited"), and it takes down the dashboard, which is the one surface
 * that could delete the offending override.
 *
 * These run the REAL built server over stdio, because the failure only exists in
 * the module-evaluation ordering of the actual entrypoint: the config cache is
 * already warm by the time the entry file's own first read happens, so the call
 * that truly rebuilds from the poisoned environment is the forced reload inside
 * parseArgs(). An in-process test would not reproduce that ordering.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SERVER = path.join(REPO_ROOT, 'dist', 'server', 'index-server.js');

let tmpRoot: string;
let catalog: string;
let overlayFile: string;

/** Send a single `initialize` over stdio and report what the server did. */
function boot(opts: { overlay?: Record<string, string>; env?: Record<string, string>; cwd?: string }) {
  fs.writeFileSync(overlayFile, JSON.stringify(opts.overlay ?? {}), 'utf8');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    INDEX_SERVER_DIR: catalog,
    INDEX_SERVER_OVERRIDES_FILE: overlayFile,
    INDEX_SERVER_DASHBOARD: '0',
    INDEX_SERVER_AUTO_BACKUP: '0',
    ...opts.env,
  };
  if (!opts.env || !('INDEX_SERVER_MESSAGING_DIR' in opts.env)) {
    delete env.INDEX_SERVER_MESSAGING_DIR;
  }

  const req = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'spec', version: '1' } },
  }) + '\n';

  const r = spawnSync(process.execPath, [SERVER], { input: req, env, encoding: 'utf8', timeout: 60000, cwd: opts.cwd });
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  return {
    status: r.status,
    answeredInitialize: stdout.includes('"result"') && stdout.includes('protocolVersion'),
    recovered: /the persisted override overlay was ignored/.test(stderr),
    stderr,
    overlayOnDisk: JSON.parse(fs.readFileSync(overlayFile, 'utf8')),
  };
}

beforeAll(() => {
  if (!fs.existsSync(SERVER)) {
    throw new Error(`built server not found at ${SERVER} — run \`npm run build\` before this suite`);
  }
});

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'idxsrv-overlay-'));
  catalog = path.join(tmpRoot, 'instructions');
  fs.mkdirSync(catalog, { recursive: true });
  overlayFile = path.join(tmpRoot, 'runtime-overrides.json');
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('overlay boot recovery', () => {
  it('boots despite an overlay value that makes config parsing throw', () => {
    // A messaging store inside the instruction catalog is refused at startup.
    const poisoned = path.join(catalog, 'messages');
    const out = boot({ overlay: { INDEX_SERVER_MESSAGING_DIR: poisoned } });

    expect(out.answeredInitialize).toBe(true);
    expect(out.status).toBe(0);
    // and it must SAY it ignored the overlay, naming the cause
    expect(out.recovered).toBe(true);
    expect(out.stderr).toMatch(/INDEX_SERVER_MESSAGING_DIR/);
    // the file itself is left intact for the operator to inspect and fix
    expect(out.overlayOnDisk.INDEX_SERVER_MESSAGING_DIR).toBe(poisoned);
  }, 90000);

  it('still fails loudly when the bad value comes from the real environment', () => {
    // Recovery must not become a blanket swallow: an operator-set env var is
    // visible and fixable, so the guard has to keep failing closed there.
    const poisoned = path.join(catalog, 'messages');
    const out = boot({ overlay: {}, env: { INDEX_SERVER_MESSAGING_DIR: poisoned } });

    expect(out.answeredInitialize).toBe(false);
    expect(out.status).not.toBe(0);
    expect(out.stderr).toMatch(/inside the instruction catalog/i);
  }, 90000);

  it('boots normally with a clean overlay (control)', () => {
    const out = boot({ overlay: {} });
    expect(out.answeredInitialize).toBe(true);
    expect(out.status).toBe(0);
    expect(out.recovered).toBe(false);
  }, 90000);

  it('actually emits the messaging deployment warnings at boot', () => {
    // Seam test. getMessagingStoreWarnings() is unit-tested as a pure function
    // and the server boot is tested above, but nothing proved the server ever
    // CALLS it — and the warning is also allowlisted in the log-hygiene gate,
    // so a silently-unwired diagnostic would leave no trace anywhere.
    //
    // Retargeted when the messaging default moved to STATE_ROOT (#577). This
    // used to key on the "INDEX_SERVER_DIR is not set" warning, which was
    // REMOVED because it became false — STATE_ROOT has no cwd fallback, so an
    // unset catalog no longer silos the store. The seam is what matters, not
    // which warning proves it, so it now uses the surviving one: an orphaned
    // legacy store at `<cwd>/data/messaging`.
    const legacyCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-msg-'));
    const legacyStore = path.join(legacyCwd, 'data', 'messaging');
    fs.mkdirSync(legacyStore, { recursive: true });
    fs.writeFileSync(path.join(legacyStore, 'messages.jsonl'), '{"id":"stranded"}\n', 'utf8');

    try {
      const out = boot({ overlay: {}, cwd: legacyCwd });

      expect(out.answeredInitialize).toBe(true);
      expect(out.stderr).toMatch(/\[messaging\].*legacy messaging store/i);
      // and it must not carry a stack trace: only ERROR should (log-hygiene gate)
      const line = out.stderr.split('\n').find((l) => /\[messaging\].*legacy messaging store/i.test(l));
      expect(line).toBeDefined();
      expect(line).not.toMatch(/\\n\s+at /);
    } finally {
      fs.rmSync(legacyCwd, { recursive: true, force: true });
    }
  }, 90000);

  it('stays quiet when there is no legacy store to report (control)', () => {
    // Without this, the case above cannot distinguish "the seam is wired" from
    // "the server prints that string unconditionally".
    const cleanCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-msg-'));
    try {
      const out = boot({ overlay: {}, cwd: cleanCwd });
      expect(out.stderr).not.toMatch(/\[messaging\].*legacy messaging store/i);
      expect(out.stderr).not.toMatch(/\[messaging\] INDEX_SERVER_DIR is not set/);
    } finally {
      fs.rmSync(cleanCwd, { recursive: true, force: true });
    }
  }, 90000);
});
