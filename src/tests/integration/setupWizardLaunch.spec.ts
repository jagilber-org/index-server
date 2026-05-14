/**
 * Setup Wizard Launch Integration Tests
 *
 * Validates that mcp.json files produced by the setup wizard:
 *   1. Never contain npx ephemeral cache paths (`_npx/<hash>/...`).
 *   2. Reference an `args[0]` that exists on disk at write time.
 *   3. Produce a server process that responds to a JSON-RPC `initialize`
 *      request — i.e. the generated config actually launches a working
 *      MCP server, not just produces matching text.
 *
 * Background: a prior regression baked `<userCache>/_npx/<hash>/.../dist/server/index-server.js`
 * into mcp.json args because the wizard wrote config BEFORE deploying the
 * runtime. By the time the MCP client tried to launch the server, the npx
 * cache had been evicted → `spawn node ENOENT`. The earlier parity suite
 * compared two write paths' text output but never exercised the live config.
 */
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse as parseJsoncValue } from 'jsonc-parser';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const WIZARD_SCRIPT = path.join(ROOT, 'scripts', 'build', 'setup-wizard.mjs');

const IS_WINDOWS = process.platform === 'win32';
const DEPLOY_TIMEOUT_MS = IS_WINDOWS ? 720_000 : 240_000;

interface McpServerEntry {
  type?: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

function vsCodeGlobalMcpPath(appData: string, home: string, flavor = 'Code'): string {
  if (IS_WINDOWS) return path.join(appData, flavor, 'User', 'mcp.json');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', flavor, 'User', 'mcp.json');
  return path.join(home, '.config', flavor, 'User', 'mcp.json');
}

function parseMcp(filePath: string): McpServerEntry {
  const text = fs.readFileSync(filePath, 'utf8');
  const config = parseJsoncValue(text) as { servers?: Record<string, McpServerEntry>; mcpServers?: Record<string, McpServerEntry> };
  const map = config.servers ?? config.mcpServers ?? {};
  const entry = map['index-server'];
  if (!entry) throw new Error(`No index-server entry in ${filePath}: ${text.slice(0, 200)}`);
  return entry;
}

describe('Setup wizard launch integration', () => {
  it(
    'global VS Code config never references the npx ephemeral cache',
    () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-launch-'));
      const tmpAppData = path.join(tmpHome, 'AppData', 'Roaming');
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-root-'));
      try {
        fs.mkdirSync(tmpAppData, { recursive: true });
        const result = spawnSync(process.execPath, [
          WIZARD_SCRIPT,
          '--non-interactive',
          '--target', 'vscode',
          '--scope', 'global',
          '--root', tmpRoot,
          '--write',
          '--no-preview',
          '--no-deploy', // skip nested npm install — we test launch resolution, not deploy
        ], {
          cwd: ROOT,
          env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, APPDATA: tmpAppData },
          encoding: 'utf8',
          timeout: 60_000,
        });
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

        const mcpPath = vsCodeGlobalMcpPath(tmpAppData, tmpHome);
        expect(fs.existsSync(mcpPath)).toBe(true);
        const entry = parseMcp(mcpPath);

        // No ephemeral npx paths anywhere in the entry
        const serialized = JSON.stringify(entry);
        expect(serialized).not.toMatch(/[\\/]_npx[\\/]/i);

        // cwd, when present, must point to a real directory we control —
        // never to __dirname-based package install.
        if (entry.cwd) {
          expect(entry.cwd.replace(/\//g, path.sep)).toBe(tmpRoot.replace(/\//g, path.sep));
        }
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it(
    'rewrites an existing mcp.json whose args were baked into an _npx path',
    () => {
      // Defense-in-depth: simulate the "evicted npx cache" failure mode. A
      // prior wizard run (pre-fix) wrote an _npx-baked entry; the cache has
      // since been evicted; the user reruns the wizard. The new run must
      // rewrite the entry without _npx.
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-rewrite-'));
      const tmpAppData = path.join(tmpHome, 'AppData', 'Roaming');
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-rewrite-root-'));
      try {
        fs.mkdirSync(tmpAppData, { recursive: true });
        const mcpPath = vsCodeGlobalMcpPath(tmpAppData, tmpHome);
        fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
        // Plant a poisoned mcp.json with an _npx path baked into args[0].
        const poisoned = {
          servers: {
            'index-server': {
              type: 'stdio',
              command: 'node',
              args: ['C:/Users/x/AppData/Local/npm-cache/_npx/deadbeef/dist/server/index-server.js'],
              cwd: 'C:/Users/x/AppData/Local/npm-cache/_npx/deadbeef',
              env: {},
            },
          },
        };
        fs.writeFileSync(mcpPath, JSON.stringify(poisoned, null, 2));

        const result = spawnSync(process.execPath, [
          WIZARD_SCRIPT,
          '--non-interactive',
          '--target', 'vscode',
          '--scope', 'global',
          '--root', tmpRoot,
          '--write',
          '--no-preview',
          '--no-deploy',
        ], {
          cwd: ROOT,
          env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, APPDATA: tmpAppData },
          encoding: 'utf8',
          timeout: 60_000,
        });
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

        const entry = parseMcp(mcpPath);
        // The wizard MUST have rewritten the entry — no _npx anywhere now.
        expect(JSON.stringify(entry)).not.toMatch(/[\\/]_npx[\\/]/i);
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it(
    'is idempotent: two runs with identical args produce bit-identical mcp.json',
    () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-idem-'));
      const tmpAppData = path.join(tmpHome, 'AppData', 'Roaming');
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-idem-root-'));
      try {
        fs.mkdirSync(tmpAppData, { recursive: true });
        const args = [
          WIZARD_SCRIPT,
          '--non-interactive',
          '--target', 'vscode',
          '--scope', 'global',
          '--root', tmpRoot,
          '--write',
          '--no-preview',
          '--no-deploy',
        ];
        const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, APPDATA: tmpAppData };

        const first = spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: 'utf8', timeout: 60_000 });
        expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
        const mcpPath = vsCodeGlobalMcpPath(tmpAppData, tmpHome);
        const firstBytes = fs.readFileSync(mcpPath);

        const second = spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: 'utf8', timeout: 60_000 });
        expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0);
        const secondBytes = fs.readFileSync(mcpPath);

        expect(secondBytes.equals(firstBytes)).toBe(true);
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it(
    'rewrites an existing mcp.json whose args were baked into an _npx path',
    () => {
      // Defense-in-depth: simulate the "evicted npx cache" failure mode. A
      // prior wizard run (pre-fix) wrote an _npx-baked entry; the cache has
      // since been evicted; the user reruns the wizard. The new run must
      // rewrite the entry without _npx.
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-rewrite-'));
      const tmpAppData = path.join(tmpHome, 'AppData', 'Roaming');
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-rewrite-root-'));
      try {
        fs.mkdirSync(tmpAppData, { recursive: true });
        const mcpPath = vsCodeGlobalMcpPath(tmpAppData, tmpHome);
        fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
        // Plant a poisoned mcp.json with an _npx path baked into args[0].
        const poisoned = {
          servers: {
            'index-server': {
              type: 'stdio',
              command: 'node',
              args: ['C:/Users/x/AppData/Local/npm-cache/_npx/deadbeef/dist/server/index-server.js'],
              cwd: 'C:/Users/x/AppData/Local/npm-cache/_npx/deadbeef',
              env: {},
            },
          },
        };
        fs.writeFileSync(mcpPath, JSON.stringify(poisoned, null, 2));

        const result = spawnSync(process.execPath, [
          WIZARD_SCRIPT,
          '--non-interactive',
          '--target', 'vscode',
          '--scope', 'global',
          '--root', tmpRoot,
          '--write',
          '--no-preview',
          '--no-deploy',
        ], {
          cwd: ROOT,
          env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, APPDATA: tmpAppData },
          encoding: 'utf8',
          timeout: 60_000,
        });
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

        const entry = parseMcp(mcpPath);
        // The wizard MUST have rewritten the entry — no _npx anywhere now.
        expect(JSON.stringify(entry)).not.toMatch(/[\\/]_npx[\\/]/i);
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it(
    'is idempotent: two runs with identical args produce bit-identical mcp.json',
    () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-idem-'));
      const tmpAppData = path.join(tmpHome, 'AppData', 'Roaming');
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-idem-root-'));
      try {
        fs.mkdirSync(tmpAppData, { recursive: true });
        const args = [
          WIZARD_SCRIPT,
          '--non-interactive',
          '--target', 'vscode',
          '--scope', 'global',
          '--root', tmpRoot,
          '--write',
          '--no-preview',
          '--no-deploy',
        ];
        const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, APPDATA: tmpAppData };

        const first = spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: 'utf8', timeout: 60_000 });
        expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
        const mcpPath = vsCodeGlobalMcpPath(tmpAppData, tmpHome);
        const firstBytes = fs.readFileSync(mcpPath);

        const second = spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: 'utf8', timeout: 60_000 });
        expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0);
        const secondBytes = fs.readFileSync(mcpPath);

        expect(secondBytes.equals(firstBytes)).toBe(true);
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it(
    'detects VS Code Insiders alongside stable and emits an entry for each',
    () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-flavors-'));
      const tmpAppData = path.join(tmpHome, 'AppData', 'Roaming');
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-flavors-root-'));
      try {
        // Pre-create both flavor directories so the wizard's detection logic
        // picks them up.
        const stableDir = IS_WINDOWS ? path.join(tmpAppData, 'Code')
          : process.platform === 'darwin' ? path.join(tmpHome, 'Library', 'Application Support', 'Code')
          : path.join(tmpHome, '.config', 'Code');
        const insidersDir = IS_WINDOWS ? path.join(tmpAppData, 'Code - Insiders')
          : process.platform === 'darwin' ? path.join(tmpHome, 'Library', 'Application Support', 'Code - Insiders')
          : path.join(tmpHome, '.config', 'Code - Insiders');
        fs.mkdirSync(stableDir, { recursive: true });
        fs.mkdirSync(insidersDir, { recursive: true });

        const result = spawnSync(process.execPath, [
          WIZARD_SCRIPT,
          '--non-interactive',
          '--target', 'vscode',
          '--scope', 'global',
          '--root', tmpRoot,
          '--write',
          '--no-preview',
          '--no-deploy',
        ], {
          cwd: ROOT,
          env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, APPDATA: tmpAppData },
          encoding: 'utf8',
          timeout: 60_000,
        });
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

        const stableMcp = vsCodeGlobalMcpPath(tmpAppData, tmpHome, 'Code');
        const insidersMcp = vsCodeGlobalMcpPath(tmpAppData, tmpHome, 'Code - Insiders');
        expect(fs.existsSync(stableMcp), `stable mcp.json missing at ${stableMcp}`).toBe(true);
        expect(fs.existsSync(insidersMcp), `insiders mcp.json missing at ${insidersMcp}`).toBe(true);

        // Both must reference the same launch entry (no _npx).
        for (const p of [stableMcp, insidersMcp]) {
          const entry = parseMcp(p);
          expect(JSON.stringify(entry)).not.toMatch(/[\\/]_npx[\\/]/i);
        }
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it(
    'generated mcp.json launches a server that responds to initialize',
    async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-live-'));
      const tmpAppData = path.join(tmpHome, 'AppData', 'Roaming');
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-live-root-'));
      try {
        fs.mkdirSync(tmpAppData, { recursive: true });
        // Use --no-deploy and rely on the in-tree dist/ via resolveServerLaunch
        // packaged path. This is fast (no nested npm install) and exercises
        // the *exact* launch contract a real MCP client would.
        const result = spawnSync(process.execPath, [
          WIZARD_SCRIPT,
          '--non-interactive',
          '--target', 'vscode',
          '--scope', 'repo',
          '--root', tmpRoot,
          '--write',
          '--no-preview',
          '--no-deploy',
        ], {
          cwd: ROOT,
          env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, APPDATA: tmpAppData },
          encoding: 'utf8',
          timeout: 60_000,
        });
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

        const mcpPath = path.join(tmpRoot, '.vscode', 'mcp.json');
        const entry = parseMcp(mcpPath);

        // Resolve args relative to entry.cwd (or tmpRoot if absent).
        const argsResolved = entry.args.map(a =>
          path.isAbsolute(a) ? a : path.resolve(entry.cwd ?? tmpRoot, a),
        );
        // The referenced entry file must exist on disk.
        const entryFile = argsResolved[0];
        expect(fs.existsSync(entryFile), `entry file missing: ${entryFile}`).toBe(true);

        // Spawn it and send a JSON-RPC initialize. Server must respond on stdout.
        const child = spawn(entry.command, argsResolved, {
          cwd: entry.cwd,
          env: { ...process.env, ...entry.env, INDEX_SERVER_DASHBOARD: '0' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        try {
          const responsePromise = new Promise<string>((resolve, reject) => {
            const chunks: Buffer[] = [];
            const timer = setTimeout(() => reject(new Error('timeout waiting for initialize response')), 15_000);
            child.stdout.on('data', (b: Buffer) => {
              chunks.push(b);
              const text = Buffer.concat(chunks).toString('utf8');
              if (text.includes('"id":1') && text.includes('result')) {
                clearTimeout(timer);
                resolve(text);
              }
            });
            child.on('error', err => { clearTimeout(timer); reject(err); });
            child.on('exit', code => { clearTimeout(timer); reject(new Error(`server exited (${code}) before responding`)); });
          });

          const initialize = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              clientInfo: { name: 'launch-test', version: '0.0.1' },
              capabilities: {},
            },
          }) + '\n';
          child.stdin.write(initialize);

          const text = await responsePromise;
          expect(text).toMatch(/"result"/);
        } finally {
          child.kill('SIGTERM');
        }
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

describe('resolveServerLaunch ephemeral-npx guard', () => {
  it('rejects packaged entries that live under an _npx/<hash>/ ancestor', () => {
    // Import compiled output so the test mirrors the runtime path the wizard takes.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(path.join(ROOT, 'dist', 'services', 'mcpConfig', 'formats'));
    expect(mod.isEphemeralNpxPath('/home/u/.npm/_npx/abc/node_modules/x/dist/server/index-server.js')).toBe(true);
    expect(mod.isEphemeralNpxPath('C:/Users/x/AppData/Local/npm-cache/_npx/abc/dist/server/index-server.js')).toBe(true);
    expect(mod.isEphemeralNpxPath('C:/Users/x/AppData/Local/index-server/dist/server/index-server.js')).toBe(false);
  });

  // Live: if the test process itself happens to be in an _npx path, the
  // resolver must fall back to either 'local' (config.root contains dist/)
  // or 'npx'. It must NEVER return 'packaged' with a path under _npx.
  it('never returns a packaged entry with _npx in its path', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(path.join(ROOT, 'dist', 'services', 'mcpConfig', 'formats'));
    const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-resolve-'));
    try {
      const launch = mod.resolveServerLaunch({ root: fakeRoot });
      expect(launch.source === 'packaged' && /[\\/]_npx[\\/]/i.test(launch.args[0] ?? '')).toBe(false);
    } finally {
      fs.rmSync(fakeRoot, { recursive: true, force: true });
    }
  });

  // End-to-end exercise of the rejection branch: copy the compiled formats.js
  // (and its sibling deps) into a synthetic <tmp>/_npx/<hash>/pkg/dist/...
  // layout, plant a packagedEntry alongside it, then require() from that
  // location. The resolver's `packageRoot` (path.resolve(__dirname,'..','..','..'))
  // now lands under _npx → resolver must fall through to source: 'npx'.
  it('falls back to npx when loaded from a synthetic _npx tree', () => {
    const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'npx-cache-'));
    try {
      const hashDir = path.join(cacheRoot, '_npx', 'abc123def456');
      const pkgRoot = path.join(hashDir, 'pkg');
      const distDir = path.join(pkgRoot, 'dist');
      // Mirror the full compiled dist/ so transitive requires resolve normally.
      fs.cpSync(path.join(ROOT, 'dist'), distDir, { recursive: true });
      // Link node_modules so transitive dependencies (jsonc-parser etc.) resolve.
      const nmTarget = path.join(pkgRoot, 'node_modules');
      try {
        fs.symlinkSync(path.join(ROOT, 'node_modules'), nmTarget, 'junction');
      } catch {
        // Fallback for environments where junctions fail: copy is too slow,
        // so skip and rely on Node's upward node_modules lookup from cacheRoot.
      }
      // Sanity: packagedEntry exists and is under _npx.
      const packagedEntry = path.join(distDir, 'server', 'index-server.js');
      expect(fs.existsSync(packagedEntry)).toBe(true);
      expect(/[\\/]_npx[\\/]/i.test(packagedEntry)).toBe(true);

      const formatsPath = path.join(distDir, 'services', 'mcpConfig', 'formats.js');
      // Bust the require cache for this absolute path so we get a fresh
      // module bound to the synthetic __dirname.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      delete require.cache[require.resolve(formatsPath)];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(formatsPath);

      // config.root has no dist/ → localEntry miss → resolver inspects packagedEntry.
      // packagedEntry exists under _npx → isEphemeralNpxPath rejects → falls through to npx.
      const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'npx-empty-root-'));
      try {
        const launch = mod.resolveServerLaunch({ root: emptyRoot });
        expect(launch.source).toBe('npx');
        expect(launch.command).toBe('npx');
        expect(launch.args).toEqual(['-y', '@jagilber-org/index-server']);
      } finally {
        fs.rmSync(emptyRoot, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(cacheRoot, { recursive: true, force: true });
    }
  });
});
