/**
 * Messaging storage must resolve to ONE directory for every MCP client.
 *
 * Regression under test: the default was `path.join(process.cwd(), 'data/messaging')`.
 * Every MCP client launches the server from a different working directory, so
 * each client silently got its own private store — a broadcast sent from VS Code
 * was invisible to Claude Code, with no error raised anywhere.
 *
 * Covers the four guarantees:
 *   1. Different cwds + same INDEX_SERVER_DIR  -> one messaging directory.
 *   2. A message written by one running instance is visible to another.
 *   3. Explicit INDEX_SERVER_MESSAGING_DIR overrides the derived default.
 *   4. Messaging files can never land inside the instruction catalog.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { resolveMessagingDir, resolveInstructionsDir, isPathInside, getMessagingStoreWarnings } from '../../../config/pathResolution';
import { parseMessagingConfig } from '../../../config/featureConfig';
import { DIR } from '../../../config/dirConstants';

const ENV_KEYS = ['INDEX_SERVER_DIR', 'INDEX_SERVER_MESSAGING_DIR', 'INDEX_SERVER_MESSAGING_ENABLED'] as const;
const saved: Record<string, string | undefined> = {};

/** Normalize for comparison: absolute, forward slashes, case-folded on Windows. */
function norm(p: string): string {
  const abs = path.resolve(p).split(path.sep).join('/');
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const TS_REGISTER = path.join(REPO_ROOT, 'node_modules', 'ts-node', 'register', 'transpile-only.js');
const RESOLVER = path.join(REPO_ROOT, 'src', 'config', 'pathResolution.ts');
const FEATURE_CONFIG = path.join(REPO_ROOT, 'src', 'config', 'featureConfig.ts');
const MAILBOX = path.join(REPO_ROOT, 'src', 'services', 'messaging', 'agentMailbox.ts');

/** Env every child needs: a shared catalog, no override, ts-node transpile-only. */
function childEnv(instructionsDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TS_NODE_PROJECT: path.join(REPO_ROOT, 'tsconfig.json'),
    TS_NODE_TRANSPILE_ONLY: 'true',
    INDEX_SERVER_DIR: instructionsDir,
    INDEX_SERVER_MESSAGING_DIR: '',
    // Scope STATE_ROOT to the per-test temp dir.
    //
    // Required once the messaging default moved from a catalog sibling to
    // `<STATE_ROOT>/data/messaging` (#577): isolation used to come for free
    // from INDEX_SERVER_DIR pointing at a temp catalog, and without this the
    // children would read and WRITE the developer's real store under
    // %LOCALAPPDATA% / $XDG_STATE_HOME. That is not merely untidy — it made
    // "mailbox is empty before the writer runs" fail against leftover messages,
    // and a passing run would have silently appended test traffic to real data.
    INDEX_SERVER_STATE_ROOT: path.join(tmpRoot, 'state'),
  };
}

/**
 * Run a snippet in a child process with a real, distinct working directory.
 * `CWD` in configUtils is captured at module load, so cwd-independence cannot
 * be proven with `process.chdir()` inside this process — the constant would not
 * change, and the buggy implementation would pass. Separate processes are the
 * only honest test.
 */
function runInCwd(cwd: string, instructionsDir: string, body: string): string {
  const script = `
    const { resolveMessagingDir } = require(${JSON.stringify(RESOLVER)});
    const fs = require('fs'), path = require('path');
    const dir = resolveMessagingDir();
    ${body}
  `;
  return execFileSync(process.execPath, ['-r', TS_REGISTER, '-e', script], {
    cwd,
    encoding: 'utf8',
    env: childEnv(instructionsDir),
  }).trim();
}

let tmpRoot: string;

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'idxsrv-msg-'));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Same INDEX_SERVER_DIR from different working directories -> one directory
// ─────────────────────────────────────────────────────────────────────────────
describe('messaging dir — independence from process.cwd()', () => {
  it('resolves identically from two different working directories', () => {
    const instructions = path.join(tmpRoot, 'index-server');
    const cwdA = path.join(tmpRoot, 'clientA');
    const cwdB = path.join(tmpRoot, 'clientB');
    for (const d of [instructions, cwdA, cwdB]) fs.mkdirSync(d, { recursive: true });

    const emit = 'process.stdout.write(dir);';
    const fromA = runInCwd(cwdA, instructions, emit);
    const fromB = runInCwd(cwdB, instructions, emit);

    // THE load-bearing assertion, and it is unchanged: two clients started from
    // different working directories must resolve the SAME store. Everything
    // else in this suite is a statement about how that is achieved.
    expect(norm(fromA)).toBe(norm(fromB));
    // and specifically NOT the old cwd-relative default
    expect(norm(fromA)).not.toBe(norm(path.join(cwdA, 'data', 'messaging')));
    expect(norm(fromA).startsWith(norm(cwdA))).toBe(false);
    expect(norm(fromB).startsWith(norm(cwdB))).toBe(false);
  });

  it('resolves outside the working directory and outside the catalog', () => {
    // Was "derives the sibling of the instruction catalog". The default moved
    // to STATE_ROOT (#577): the sibling layout delivered one shared store only
    // when INDEX_SERVER_DIR was set identically in every client, and fell back
    // to `<cwd>/index-messaging` when it was unset — the very siloing this
    // module exists to prevent. STATE_ROOT is per-user with no cwd fallback.
    //
    // The two properties that actually matter are asserted directly rather than
    // via a path shape: not under cwd, and not inside the catalog (message
    // files there are loaded as malformed instructions and corrupt the index).
    const catalog = path.join(tmpRoot, 'Internal', 'index-server');
    process.env.INDEX_SERVER_DIR = catalog;
    delete process.env.INDEX_SERVER_MESSAGING_DIR;

    const resolved = norm(resolveMessagingDir());
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved.startsWith(norm(process.cwd()))).toBe(false);
    expect(resolved.startsWith(norm(catalog))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. A message sent by one running instance reaches an already-loaded instance
// ─────────────────────────────────────────────────────────────────────────────
describe('messaging dir — cross-instance visibility', () => {
  it('delivers a broadcast sent from cwd A to a mailbox already loaded in cwd B', () => {
    const instructions = path.join(tmpRoot, 'index-server');
    const cwdA = path.join(tmpRoot, 'clientA');
    const cwdB = path.join(tmpRoot, 'clientB');
    for (const d of [instructions, cwdA, cwdB]) fs.mkdirSync(d, { recursive: true });

    // The writer is a genuinely separate process, started by the reader *after*
    // the reader's mailbox is loaded — the exact ordering that used to fail.
    const writer = `
      const { parseMessagingConfig } = require(${JSON.stringify(FEATURE_CONFIG)});
      const { AgentMailbox } = require(${JSON.stringify(MAILBOX)});
      const mb = new AgentMailbox({ ...parseMessagingConfig(), sweepIntervalMs: 0 });
      mb.send({ channel: 'shared', sender: 'client-a', recipients: ['*'], body: 'hello from client A' })
        .then(() => process.exit(0))
        .catch((err) => { console.error(err); process.exit(1); });
    `;
    const reader = `
      const { execFileSync } = require('child_process');
      const { parseMessagingConfig } = require(${JSON.stringify(FEATURE_CONFIG)});
      const { AgentMailbox } = require(${JSON.stringify(MAILBOX)});
      const cfg = parseMessagingConfig();
      const mb = new AgentMailbox({ ...cfg, sweepIntervalMs: 0 });
      mb.ensureLoaded();
      const before = mb.read({ reader: '*' }).length;
      execFileSync(process.execPath, ['-r', ${JSON.stringify(TS_REGISTER)}, '-e', ${JSON.stringify(writer)}], {
        cwd: ${JSON.stringify(cwdA)},
        env: process.env,
        stdio: 'inherit',
      });
      const after = mb.read({ channel: 'shared', reader: '*' });
      process.stdout.write(JSON.stringify({
        dir: cfg.dir,
        before,
        bodies: after.map((m) => m.body),
        channels: mb.listChannels().map((c) => c.channel),
        unread: mb.getStats('client-b').unread,
      }));
    `;

    const out = JSON.parse(execFileSync(process.execPath, ['-r', TS_REGISTER, '-e', reader], {
      cwd: cwdB,
      encoding: 'utf8',
      env: childEnv(instructions),
    }).trim());

    expect(out.before).toBe(0);
    expect(out.bodies).toEqual(['hello from client A']);
    expect(out.channels).toContain('shared');
    expect(out.unread).toBe(1);
    // The property that matters: both processes agreed on ONE store, and it is
    // neither client's working directory. The exact location moved to STATE_ROOT
    // (#577); asserting a specific path here would re-pin the means over the end.
    expect(norm(out.dir).startsWith(norm(cwdA))).toBe(false);
    expect(norm(out.dir).startsWith(norm(cwdB))).toBe(false);
    expect(fs.existsSync(path.join(out.dir, 'messages.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(out.dir, '.messages-version'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Explicit override wins
// ─────────────────────────────────────────────────────────────────────────────
describe('messaging dir — explicit override precedence', () => {
  it('INDEX_SERVER_MESSAGING_DIR beats the derived default', () => {
    const custom = path.join(tmpRoot, 'somewhere-else', 'msgs');
    process.env.INDEX_SERVER_DIR = path.join(tmpRoot, 'index-server');
    process.env.INDEX_SERVER_MESSAGING_DIR = custom;
    expect(norm(resolveMessagingDir())).toBe(norm(custom));
  });

  it('an empty or whitespace override falls back to the derived default', () => {
    process.env.INDEX_SERVER_DIR = path.join(tmpRoot, 'index-server');
    process.env.INDEX_SERVER_MESSAGING_DIR = '   ';
    // Falls back to the DERIVED default, whatever that is - the point is that a
    // whitespace override is treated as absent, not as a relative path.
    delete process.env.INDEX_SERVER_MESSAGING_DIR2;
    const whitespace = norm(resolveMessagingDir());
    delete process.env.INDEX_SERVER_MESSAGING_DIR;
    expect(whitespace).toBe(norm(resolveMessagingDir()));
  });

  it('trims surrounding whitespace instead of resolving it against cwd', () => {
    // A `.env`-style `INDEX_SERVER_MESSAGING_DIR= C:\store` has a leading space.
    // Untrimmed, that defeats path.isAbsolute() and the value resolves against
    // CWD — reinstating the per-client split-brain this module exists to fix.
    const custom = path.join(tmpRoot, 'somewhere-else', 'msgs');
    process.env.INDEX_SERVER_DIR = path.join(tmpRoot, 'index-server');
    process.env.INDEX_SERVER_MESSAGING_DIR = `  ${custom}  `;

    const resolved = resolveMessagingDir();
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(norm(resolved)).toBe(norm(custom));
    expect(norm(resolved)).not.toContain(norm(process.cwd()));
  });

  it('accepts an override on a different drive (win32 cross-drive relative)', () => {
    // path.win32.relative('C:\\a','D:\\b') returns 'D:\\b' — absolute, and it
    // does NOT start with '..'. Without the isAbsolute() arm of isPathInside a
    // cross-drive override is misread as *inside* the catalog and the server
    // refuses to boot. Guards the arm directly, on every platform.
    const other = process.platform === 'win32' ? 'D:\\messaging-store' : '/other-root/messaging-store';
    expect(isPathInside(other, path.join(tmpRoot, 'index-server'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Messaging can never contaminate the instruction catalog
// ─────────────────────────────────────────────────────────────────────────────
describe('messaging dir — instruction catalog isolation', () => {
  it('the derived default is never inside the instruction catalog', () => {
    for (const catalog of [
      path.join(tmpRoot, 'index-server'),
      path.join(tmpRoot, 'nested', 'deep', 'instructions'),
      tmpRoot,
    ]) {
      process.env.INDEX_SERVER_DIR = catalog;
      delete process.env.INDEX_SERVER_MESSAGING_DIR;
      expect(isPathInside(resolveMessagingDir(), resolveInstructionsDir())).toBe(false);
    }
  });

  it('throws when an explicit override points inside the catalog', () => {
    const catalog = path.join(tmpRoot, 'index-server');
    process.env.INDEX_SERVER_DIR = catalog;
    process.env.INDEX_SERVER_MESSAGING_DIR = path.join(catalog, 'messages');
    expect(() => resolveMessagingDir()).toThrow(/inside the instruction catalog/i);
  });

  it('throws when an explicit override equals the catalog itself', () => {
    const catalog = path.join(tmpRoot, 'index-server');
    process.env.INDEX_SERVER_DIR = catalog;
    process.env.INDEX_SERVER_MESSAGING_DIR = catalog;
    expect(() => resolveMessagingDir()).toThrow(/inside the instruction catalog/i);
  });

  it('names the override in the explicit case and the derivation in the derived case', () => {
    // Both branches share the "inside the instruction catalog" suffix, so a test
    // matching only that suffix passes even if the two branches are swapped.
    // Pin the distinguishing half: the operator's next action differs.
    const catalog = path.join(tmpRoot, 'index-server');
    process.env.INDEX_SERVER_DIR = catalog;
    process.env.INDEX_SERVER_MESSAGING_DIR = path.join(catalog, 'messages');
    expect(() => resolveMessagingDir()).toThrow(/INDEX_SERVER_MESSAGING_DIR resolves/);

    // Derived collision: a catalog at a filesystem root makes dirname() the root
    // itself, so the sibling lands back inside the catalog with no override set.
    process.env.INDEX_SERVER_DIR = path.parse(tmpRoot).root;
    delete process.env.INDEX_SERVER_MESSAGING_DIR;
    expect(() => resolveMessagingDir()).toThrow(/derived messaging directory resolves/);
  });

  it('skips validation when messaging is disabled, so the kill-switch works', () => {
    // The containment check throws, and the result is evaluated inside the
    // getRuntimeConfig() object literal at boot. Ungated it exits the process
    // before the MCP handshake — the client sees a bare "server exited" and
    // INDEX_SERVER_MESSAGING_ENABLED=0 cannot rescue it. Nothing writes to the
    // store while disabled, so the path cannot corrupt the catalog.
    const catalog = path.join(tmpRoot, 'index-server');
    const poisoned = path.join(catalog, 'messages');
    process.env.INDEX_SERVER_DIR = catalog;
    process.env.INDEX_SERVER_MESSAGING_DIR = poisoned;

    expect(() => resolveMessagingDir(true)).toThrow(/inside the instruction catalog/i);
    expect(() => resolveMessagingDir(false)).not.toThrow();
    expect(norm(resolveMessagingDir(false))).toBe(norm(poisoned));
  });

  it('allows a sibling whose name merely starts with the catalog name', () => {
    // `index-server-messages` must not be mistaken for a child of `index-server`
    const catalog = path.join(tmpRoot, 'index-server');
    process.env.INDEX_SERVER_DIR = catalog;
    process.env.INDEX_SERVER_MESSAGING_DIR = `${catalog}-messages`;
    expect(() => resolveMessagingDir()).not.toThrow();
    expect(norm(resolveMessagingDir())).toBe(norm(`${catalog}-messages`));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The kill-switch reaches the throw (parseMessagingConfig wiring)
// ─────────────────────────────────────────────────────────────────────────────
describe('parseMessagingConfig — validation is gated on `enabled`', () => {
  it('does not throw at config-parse time when messaging is disabled', () => {
    const catalog = path.join(tmpRoot, 'index-server');
    process.env.INDEX_SERVER_DIR = catalog;
    process.env.INDEX_SERVER_MESSAGING_DIR = path.join(catalog, 'messages');

    // Enabled (the default): a poisoned path is fatal, by design.
    delete process.env.INDEX_SERVER_MESSAGING_ENABLED;
    expect(() => parseMessagingConfig()).toThrow(/inside the instruction catalog/i);

    // Disabled: the operator can boot back in and fix the override.
    process.env.INDEX_SERVER_MESSAGING_ENABLED = '0';
    const cfg = parseMessagingConfig();
    expect(cfg.enabled).toBe(false);
    expect(norm(cfg.dir)).toBe(norm(path.join(catalog, 'messages')));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. The silent failures get a signal
// ─────────────────────────────────────────────────────────────────────────────
describe('messaging dir — diagnostics for the modes that used to be silent', () => {
  it('says NOTHING about the anchor when INDEX_SERVER_DIR is unset', () => {
    // Inverted deliberately. This case previously asserted a warning that
    // INDEX_SERVER_DIR being unset silos the store per client. That was true
    // while the default was a catalog sibling — unset, it fell back to
    // `<cwd>/index-messaging`. It is FALSE once the default is
    // `<STATE_ROOT>/data/messaging`, which is per-user and has no cwd fallback.
    //
    // The warning was removed rather than reworded, and this assertion is what
    // stops it coming back: a warning that fires on a correct configuration
    // would fire on every default install, and teaches operators to ignore the
    // channel entirely.
    //
    // INDEX_SERVER_DIR is still worth pinning, but for an unrelated reason —
    // it is the containment guard's parent operand. That is asserted elsewhere.
    delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_MESSAGING_DIR;

    const warnings = getMessagingStoreWarnings().join('\n');
    expect(warnings).not.toMatch(/INDEX_SERVER_DIR is not set/);
    expect(warnings).not.toMatch(/will not see each other's messages/);
  });

  it('says nothing about the anchor when INDEX_SERVER_DIR pins the store', () => {
    process.env.INDEX_SERVER_DIR = path.join(tmpRoot, 'index-server');
    delete process.env.INDEX_SERVER_MESSAGING_DIR;

    expect(getMessagingStoreWarnings().join('\n')).not.toMatch(/INDEX_SERVER_DIR is not set/);
  });

  it('says nothing about the anchor when an explicit override pins the store', () => {
    delete process.env.INDEX_SERVER_DIR;
    process.env.INDEX_SERVER_MESSAGING_DIR = path.join(tmpRoot, 'pinned-store');

    expect(getMessagingStoreWarnings().join('\n')).not.toMatch(/INDEX_SERVER_DIR is not set/);
  });

  it('is pure — repeated calls neither latch nor write to stderr', () => {
    // Purity is what lets this be emitted exactly once, at boot, by the caller.
    // Emitting from the resolver produced one line per process and a test run
    // spawns hundreds (273 in CI), which tripped the log-hygiene threshold.
    delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_MESSAGING_DIR;

    // Seed the one condition that still produces a warning, so purity is
    // asserted over a NON-EMPTY result.
    //
    // This case used to get a warning for free from the "INDEX_SERVER_DIR is
    // not set" diagnostic, which was removed when the default moved to
    // STATE_ROOT (#577) — it had become false. Without seeding, `first` is []
    // and the assertions below hold trivially: "repeated calls agree" is
    // vacuous when both are empty. CI caught this; it passed locally only
    // because the developer's repo root happens to contain data/messaging,
    // which is exactly the kind of environment-dependent pass worth removing.
    //
    // CWD is captured at module load, so the legacy path must be seeded under
    // the real working directory rather than a temp one.
    const legacy = path.join(process.cwd(), 'data', 'messaging');
    const preexisting = fs.existsSync(legacy);
    if (!preexisting) fs.mkdirSync(legacy, { recursive: true });
    const marker = path.join(legacy, `.purity-probe-${process.pid}`);
    fs.writeFileSync(marker, 'probe', 'utf8');

    const chunks: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    (process.stderr as unknown as { write: unknown }).write = (c: unknown) => { chunks.push(String(c)); return true; };
    let first: string[], second: string[];
    try {
      first = getMessagingStoreWarnings();
      second = getMessagingStoreWarnings();
    } finally {
      (process.stderr as unknown as { write: unknown }).write = orig;
      fs.rmSync(marker, { force: true });
      // Only remove the directory if this test created it — another spec may
      // legitimately own it.
      if (!preexisting) { try { fs.rmdirSync(legacy); } catch { /* not empty: leave it */ } }
    }

    expect(first.length, 'purity over an empty result is vacuous').toBeGreaterThan(0);
    expect(second).toEqual(first);          // no latch: same answer every time
    expect(chunks.join('')).toBe('');       // and nothing was logged
  });

  it('does not throw when the messaging dir would be rejected by the guard', () => {
    // Diagnostics must never be the thing that kills startup.
    const catalog = path.join(tmpRoot, 'index-server');
    process.env.INDEX_SERVER_DIR = catalog;
    process.env.INDEX_SERVER_MESSAGING_DIR = path.join(catalog, 'messages');

    expect(() => getMessagingStoreWarnings()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isPathInside — the primitive the isolation guarantee rests on
// ─────────────────────────────────────────────────────────────────────────────
describe('isPathInside', () => {
  it('detects self, children and rejects siblings and parents', () => {
    const p = path.join(tmpRoot, 'cat');
    expect(isPathInside(p, p)).toBe(true);
    expect(isPathInside(path.join(p, 'a', 'b'), p)).toBe(true);
    expect(isPathInside(`${p}-sibling`, p)).toBe(false);
    expect(isPathInside(tmpRoot, p)).toBe(false);
  });
});
