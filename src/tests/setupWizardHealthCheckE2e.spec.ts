/**
 * Setup Wizard Health-Check E2E (Issue #389, parent #355)
 *
 * Regression net for the failure class that left #355 invisible to CI:
 *   `setupWizard.spec.ts` validates config text but never *launches* the
 *   server from the config the wizard wrote. As a result, a wizard regression
 *   that bakes a non-resolvable entry path (e.g. `MODULE_NOT_FOUND` after
 *   `npx --setup`) reaches end users before CI catches it.
 *
 * This spec closes that gap by, for each launch mode the wizard can emit:
 *   1. Running the wizard with `--root <temp-dir>` non-interactively.
 *   2. Reading the generated mcp.json from the wizard's output directory.
 *   3. Spawning the server using the **exact** `command + args + cwd + env`
 *      from that mcp.json — i.e. what a real MCP client would do.
 *   4. Performing the MCP `initialize` handshake (readiness gate).
 *   5. Invoking the `health_check` MCP tool and asserting `status === 'ok'`.
 *   6. Tearing down the server and the temp dirs.
 *
 * Both launch modes are covered:
 *   - `source = 'local'`    — wizard finds `<root>/dist/server/index-server.js`
 *                             and writes a relative `args[0]` with `cwd=<root>`.
 *                             We stage `<tmpRoot>/dist` as a junction/symlink to
 *                             the in-tree `dist/` to make this mode reproducible
 *                             without re-running `tsc`.
 *   - `source = 'packaged'` — wizard finds no `<root>/dist/...` and falls
 *                             through to `<packageRoot>/dist/...`. This is the
 *                             closest in-repo proxy for the npx-cache absolute
 *                             path mode (see resolveServerLaunch).
 *
 * Cross-platform: runs on Windows + Linux. NOT skipped on Windows. The local
 * symlink uses fs.symlink with type 'junction' on Windows (no admin needed
 * for directory junctions) and 'dir' elsewhere.
 *
 * Constitution: TS-9 (test real code paths, not mocks).
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse as parseJsoncValue } from 'jsonc-parser';

const ROOT = path.resolve(__dirname, '..', '..');
const WIZARD_SCRIPT = path.join(ROOT, 'scripts', 'build', 'setup-wizard.mjs');
const IS_WINDOWS = process.platform === 'win32';

interface McpServerEntry {
  type?: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

function parseMcp(filePath: string): McpServerEntry {
  const text = fs.readFileSync(filePath, 'utf8');
  const config = parseJsoncValue(text) as {
    servers?: Record<string, McpServerEntry>;
    mcpServers?: Record<string, McpServerEntry>;
  };
  const map = config.servers ?? config.mcpServers ?? {};
  const entry = map['index-server'];
  if (!entry) throw new Error(`No index-server entry in ${filePath}: ${text.slice(0, 200)}`);
  return entry;
}

function runWizard(tmpRoot: string, tmpHome: string): void {
  const tmpAppData = path.join(tmpHome, 'AppData', 'Roaming');
  fs.mkdirSync(tmpAppData, { recursive: true });
  const result = spawnSync(
    process.execPath,
    [
      WIZARD_SCRIPT,
      '--non-interactive',
      '--target', 'vscode',
      '--scope', 'repo',
      '--root', tmpRoot,
      '--write',
      '--no-preview',
      '--no-deploy', // skip nested npm install — we test launch resolution
    ],
    {
      cwd: ROOT,
      env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, APPDATA: tmpAppData },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(`wizard failed (${result.status}):\nSTDOUT: ${result.stdout}\nSTDERR: ${result.stderr}`);
  }
}

/**
 * Stage `<tmpRoot>/dist` as a directory symlink/junction pointing at the
 * in-tree `dist/`, so the wizard's launch resolver picks `source: 'local'`
 * without us having to copy several MB of compiled output.
 */
function stageLocalDist(tmpRoot: string): void {
  const target = path.join(ROOT, 'dist');
  const linkPath = path.join(tmpRoot, 'dist');
  // 'junction' on Windows is the only symlink type that works without admin.
  // On POSIX, 'dir' is the standard directory symlink type.
  fs.symlinkSync(target, linkPath, IS_WINDOWS ? 'junction' : 'dir');
}

interface LaunchClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  close: () => Promise<void>;
}

/**
 * Spawn a server using exactly the launch contract the generated mcp.json
 * specifies — command, args, cwd, env — and perform the MCP handshake.
 * This is intentionally a direct StdioClientTransport call rather than going
 * through helpers/mcpTestClient so we can pass `cwd` (which the helper does
 * not currently expose) and faithfully mirror what a real MCP client does.
 */
async function connectFromEntry(entry: McpServerEntry, fallbackCwd: string): Promise<LaunchClient> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

  // Merge process.env with entry.env, then force dashboard off so parallel
  // wizard E2Es don't contend for the default dashboard port.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  Object.assign(env, entry.env ?? {});
  env.INDEX_SERVER_DASHBOARD = '0';

  const transport = new StdioClientTransport({
    command: entry.command,
    args: entry.args,
    cwd: entry.cwd ?? fallbackCwd,
    env,
  });
  const client = new Client(
    { name: 'wizard-health-e2e', version: '1.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);

  return {
    client,
    close: async () => {
      try { await transport.close(); } catch { /* ignore */ }
    },
  };
}

async function callHealthCheck(client: { callTool: (opts: { name: string; arguments: Record<string, unknown> }) => Promise<unknown> }): Promise<Record<string, unknown>> {
  const resp = await client.callTool({ name: 'health_check', arguments: {} }) as {
    content?: Array<{ text?: string }>;
  };
  const text = resp?.content?.[0]?.text;
  if (!text) throw new Error(`health_check returned no text content: ${JSON.stringify(resp)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

describe('Setup wizard → health_check E2E (issue #389)', () => {
  it(
    'source=local: server spawned from generated mcp.json answers health_check with status:ok',
    async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-hc-local-home-'));
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-hc-local-root-'));
      let connection: LaunchClient | undefined;
      try {
        // Stage dist BEFORE running the wizard so resolveServerLaunch picks
        // the 'local' branch (existence check at write time).
        stageLocalDist(tmpRoot);
        runWizard(tmpRoot, tmpHome);

        const mcpPath = path.join(tmpRoot, '.vscode', 'mcp.json');
        expect(fs.existsSync(mcpPath), `mcp.json missing at ${mcpPath}`).toBe(true);
        const entry = parseMcp(mcpPath);

        // Contract assertions for the 'local' mode the wizard should have chosen.
        expect(entry.command).toBe('node');
        expect(entry.args[0]).toBeDefined();
        // 'local' mode emits a relative entry path anchored to entry.cwd.
        expect(path.isAbsolute(entry.args[0]!)).toBe(false);
        expect(entry.cwd, 'local mode must set cwd to <root>').toBeDefined();
        // Resolved entry file must exist on disk.
        const resolved = path.resolve(entry.cwd!, entry.args[0]!);
        expect(fs.existsSync(resolved), `entry file missing: ${resolved}`).toBe(true);

        connection = await connectFromEntry(entry, tmpRoot);
        const health = await callHealthCheck(connection.client);
        expect(health.status).toBe('ok');
        expect(health.version).toBeDefined();
      } finally {
        if (connection) await connection.close();
        // Remove the junction/symlink first so rmSync doesn't try to recurse
        // into the linked-to dist tree.
        try {
          const linkPath = path.join(tmpRoot, 'dist');
          if (fs.existsSync(linkPath)) fs.unlinkSync(linkPath);
        } catch { /* ignore */ }
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it(
    'source=packaged: server spawned from generated mcp.json answers health_check with status:ok',
    async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-hc-pkg-home-'));
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-hc-pkg-root-'));
      let connection: LaunchClient | undefined;
      try {
        // Deliberately do NOT stage dist under tmpRoot — wizard's launch
        // resolver should fall through to the in-tree packageRoot/dist and
        // emit source='packaged' (absolute args[0], no cwd). This is the
        // closest in-repo proxy for the npx-cache absolute path mode that
        // caused #355.
        runWizard(tmpRoot, tmpHome);

        const mcpPath = path.join(tmpRoot, '.vscode', 'mcp.json');
        expect(fs.existsSync(mcpPath), `mcp.json missing at ${mcpPath}`).toBe(true);
        const entry = parseMcp(mcpPath);

        // Contract assertions for the 'packaged' mode the wizard should have chosen.
        expect(entry.command).toBe('node');
        expect(entry.args[0]).toBeDefined();
        // 'packaged' mode emits an absolute entry path with no cwd.
        expect(path.isAbsolute(entry.args[0]!), `expected absolute args[0], got: ${entry.args[0]}`).toBe(true);
        // Never an npx ephemeral cache path — that's the #355 regression.
        expect(entry.args[0]).not.toMatch(/[\\/]_npx[\\/]/i);
        expect(fs.existsSync(entry.args[0]!), `entry file missing: ${entry.args[0]}`).toBe(true);

        connection = await connectFromEntry(entry, tmpRoot);
        const health = await callHealthCheck(connection.client);
        expect(health.status).toBe('ok');
        expect(health.version).toBeDefined();
      } finally {
        if (connection) await connection.close();
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
