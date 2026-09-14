/**
 * stateRootCwdCleanliness.spec.ts — #577's acceptance criterion, executed.
 *
 * #577's falsification bar is a statement about OBSERVED FILESYSTEM STATE:
 *
 *   "Start the compiled server from `C:\` or an empty temp dir; after one
 *    mutation, cwd must contain no new files or directories."
 *
 * Every existing test for #577 (`stateRoot.spec.ts`, 13 cases) asserts on
 * config PARSERS in isolation — `parseFeatureFlagsConfig().file.startsWith(
 * STATE_ROOT)` and siblings. Not one starts a server, performs an operation, or
 * looks at a directory listing. `activityDbPath.spec.ts` does spawn children,
 * but only to read back resolved path STRINGS; it never exercises a write.
 *
 * That gap is not academic. It is exactly why the manifest writer
 * (`manifestManager.getManifestPath()`) was missed: the reader moved to
 * STATE_ROOT while the writer stayed on `process.cwd()`, so `index_add` kept
 * creating `<cwd>/snapshots/index-manifest.json` and `integrity_manifest`
 * returned `{ manifest: 'missing' }`. A parser-level test cannot see that,
 * because no parser is involved on the write path.
 *
 * So this suite drives the real compiled server over stdio from an empty
 * directory and then lists that directory. It is the only test in the repo
 * that can fail when a NEW cwd-anchored writer is introduced — which is the
 * property #577 actually asks for, and the one most likely to regress.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const DIST_SERVER = path.resolve(__dirname, '..', '..', 'dist', 'server', 'index-server.js');

interface RpcResponse { id?: number; result?: unknown; error?: unknown }

/**
 * Drive the compiled MCP server over stdio from `cwd`, issuing `initialize`
 * followed by each tool call, and resolve once every response has arrived.
 */
function runServer(
  cwd: string,
  env: Record<string, string>,
  calls: { name: string; arguments: Record<string, unknown> }[],
): Promise<{ responses: RpcResponse[]; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DIST_SERVER], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const responses: RpcResponse[] = [];
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* already gone */ }
      if (err) reject(err); else resolve({ responses, stderr });
    };

    const timer = setTimeout(
      () => finish(new Error(`server did not answer ${calls.length + 1} frames in 60s.\nstderr:\n${stderr}`)),
      60_000,
    );

    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (e) => finish(e as Error));
    child.on('exit', (code) => {
      if (responses.length < calls.length + 1) {
        finish(new Error(`server exited early (code ${code}) after ${responses.length} responses.\nstderr:\n${stderr}`));
      }
    });

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      const lines = stdout.split('\n');
      stdout = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('{')) continue;
        try { responses.push(JSON.parse(t) as RpcResponse); } catch { /* not a frame */ }
      }
      if (responses.length >= calls.length + 1) finish();
    });

    const send = (obj: unknown) => child.stdin.write(JSON.stringify(obj) + '\n');

    send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'cwd-cleanliness-spec', version: '1.0.0' },
      },
    });
    calls.forEach((c, i) => send({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c }));
  });
}

describe('#577 acceptance: a mutation must not write into the working directory', () => {
  let cwd: string;
  let stateRoot: string;
  let catalog: string;
  let result: { responses: RpcResponse[]; stderr: string };

  beforeAll(async () => {
    expect(
      fs.existsSync(DIST_SERVER),
      'dist/ is missing — run `npm run build` before this suite',
    ).toBe(true);

    // Three separate temp trees: the cwd we assert stays empty, plus an
    // explicit state root and catalog so the run never touches the developer's
    // real %LOCALAPPDATA% state or instruction catalog.
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-clean-'));
    stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-clean-state-'));
    catalog = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-clean-catalog-'));

    expect(fs.readdirSync(cwd)).toEqual([]);

    result = await runServer(
      cwd,
      {
        INDEX_SERVER_STATE_ROOT: stateRoot,
        INDEX_SERVER_DIR: catalog,
        INDEX_SERVER_MUTATION: '1',
        INDEX_SERVER_DASHBOARD: '0',
        INDEX_SERVER_SEMANTIC_ENABLED: '0',
        INDEX_SERVER_AUTO_BACKUP: '0',
      },
      [{
        name: 'index_add',
        arguments: {
          lax: true,
          entry: {
            id: 'cwd-cleanliness-probe',
            title: 'cwd cleanliness probe',
            body: 'Written by stateRootCwdCleanliness.spec.ts to force a mutation.',
            categories: ['testing'],
            primaryCategory: 'testing',
          },
        },
      }],
    );
  }, 90_000);

  afterAll(() => {
    for (const d of [cwd, stateRoot, catalog]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });

  it('completes the handshake and the mutation', () => {
    // Guard: if this fails the cleanliness assertion below is vacuous — an
    // empty cwd proves nothing when no mutation actually ran.
    expect(result.responses.length, `stderr:\n${result.stderr}`).toBeGreaterThanOrEqual(2);
    const add = result.responses.find(r => r.id === 2);
    expect(add, `no response to index_add.\nstderr:\n${result.stderr}`).toBeDefined();
    expect(add?.error, `index_add errored: ${JSON.stringify(add?.error)}`).toBeUndefined();
  });

  it('leaves the working directory completely empty', () => {
    const left = fs.readdirSync(cwd);
    expect(
      left,
      `#577's bar: cwd must contain no new entries after a mutation, but found: ${JSON.stringify(left)}. ` +
      'Each entry is a writer still anchored to process.cwd() rather than STATE_ROOT.',
    ).toEqual([]);
  });

  it('writes its state under STATE_ROOT instead', () => {
    // The complement of the assertion above: proves the mutation's artifacts
    // went somewhere, so an empty cwd reflects correct routing rather than a
    // server that silently did nothing.
    const stateEntries = fs.readdirSync(stateRoot);
    expect(stateEntries.length, 'STATE_ROOT is empty — the server wrote nothing anywhere').toBeGreaterThan(0);
  });
});

/**
 * The backup directory, specifically.
 *
 * The suite above sets INDEX_SERVER_DIR and disables auto-backup for
 * determinism, so it cannot observe this artifact. `backupsDir` defaults to a
 * SIBLING of the resolved instruction directory, and when INDEX_SERVER_DIR is
 * unset that directory is `<cwd>/instructions` — so the default resolves back
 * to `<cwd>/backups`, and auto-backup writes a rotating, hourly, ten-deep copy
 * of the entire catalog into whatever directory the MCP client happened to be
 * launched from.
 *
 * It is not in #577's own artifact table, which is why it survived that PR.
 *
 * Resolved in a CHILD PROCESS: the config constants are evaluated at module
 * load, so an in-process `chdir` cannot distinguish a cwd-anchored default
 * from a correct one — vitest's own cwd already IS the install root. Same
 * reasoning as the subprocess block in activityDbPath.spec.ts.
 */
describe('#577: the backup directory is not anchored to the working directory', () => {
  const distRoot = path.resolve(__dirname, '..', '..', 'dist');
  let foreignCwd: string;
  let stateRoot: string;

  beforeAll(() => {
    foreignCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'backups-cwd-'));
    stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'backups-state-'));
  });

  afterAll(() => {
    for (const d of [foreignCwd, stateRoot]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });

  /** Read back the resolved backupsDir from a child started in `foreignCwd`. */
  function resolveBackupsDir(extraEnv: Record<string, string> = {}): string {
    expect(
      fs.existsSync(path.join(distRoot, 'config', 'runtimeConfig.js')),
      'dist/ is missing — run `npm run build` before this suite',
    ).toBe(true);

    const expr =
      `require(${JSON.stringify(path.join(distRoot, 'config', 'runtimeConfig.js'))})` +
      `.getRuntimeConfig().dashboard.admin.backupsDir`;

    return execFileSync(process.execPath, ['-e', `process.stdout.write(String(${expr}))`], {
      cwd: foreignCwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        INDEX_SERVER_STATE_ROOT: stateRoot,
        INDEX_SERVER_LOG_FILE: '0',
        INDEX_SERVER_ACTIVITY_LOG: '0',
        // Deliberately NOT set: INDEX_SERVER_DIR, INDEX_SERVER_BACKUPS_DIR.
        // Unset is the default install, and the case that fails the bar.
        ...extraEnv,
      },
    }).trim();
  }

  it('does not default to <cwd>/backups when INDEX_SERVER_DIR is unset', () => {
    const dir = resolveBackupsDir();

    expect(
      dir.startsWith(foreignCwd),
      `backupsDir resolved inside the spawning directory (${dir}). Auto-backup would write a ` +
      "rotating copy of the whole catalog into the client's project folder.",
    ).toBe(false);
    expect(path.isAbsolute(dir)).toBe(true);
  });

  it('anchors to STATE_ROOT by default', () => {
    const dir = resolveBackupsDir();
    expect(path.resolve(dir)).toBe(path.resolve(stateRoot, 'backups'));
  });

  it('still honours an absolute INDEX_SERVER_BACKUPS_DIR override', () => {
    // The operator keeping backups beside a catalog on another volume is a
    // legitimate setup and must keep working.
    const custom = path.join(stateRoot, 'somewhere-else');
    expect(path.resolve(resolveBackupsDir({ INDEX_SERVER_BACKUPS_DIR: custom })))
      .toBe(path.resolve(custom));
  });

  it('resolves a RELATIVE override against STATE_ROOT, not cwd', () => {
    const dir = resolveBackupsDir({ INDEX_SERVER_BACKUPS_DIR: 'rel-backups' });
    expect(dir.startsWith(foreignCwd)).toBe(false);
    expect(path.resolve(dir)).toBe(path.resolve(stateRoot, 'rel-backups'));
  });
});
