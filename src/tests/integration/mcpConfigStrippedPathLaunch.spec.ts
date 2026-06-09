/**
 * BEHAVIORAL regression: a generated MCP config must be launchable even when
 * the Node directory is NOT on PATH.
 *
 * Why this exists (and why the prior suite missed the bug):
 *   The real-world failure was "The command 'node' needed to run index-server
 *   was not found." It only manifests when the launching client's inherited
 *   PATH does not contain the Node binary directory — e.g. a VS Code / Copilot
 *   CLI / Claude Desktop process started before Node was added to PATH, or from
 *   a launcher with a stripped environment.
 *
 *   Every other launch/boot test (issue-317 boot matrix, health-check E2E)
 *   spawns with the test runner's inherited PATH, which DOES contain Node — so
 *   a PATH-dependent bare `command: 'node'` launches fine there and the bug is
 *   invisible. String-level "is absolute" assertions catch a literal revert but
 *   do not prove the runtime problem is solved.
 *
 *   This test removes the Node directory from PATH and then:
 *     (A) proves a bare `node` is genuinely unlaunchable in that environment
 *         (guards the guard — if this ever stops failing, the isolation is
 *         broken and the test below is meaningless), and
 *     (B) asserts the `command` that buildServerEntry emits for every
 *         user-machine-local format launches anyway, because it is an absolute
 *         path to an existing Node binary that needs no PATH lookup.
 *
 *   If anyone reverts buildServerEntry to a bare `node` command, (B) collapses
 *   into (A) and fails with ENOENT.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { buildServerEntry } from '../../services/mcpConfig/formats';
import type { ServerBuildConfig } from '../../services/mcpConfig/formats';
import type { McpDataPaths } from '../../services/mcpConfig/flagCatalog';

// Repo root contains a built dist/ (npm run build) so resolveServerLaunch takes
// the 'local' branch and buildServerEntry absolutizes the node command.
const ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * A PATH that is GUARANTEED to contain no `node` binary. Subtracting the
 * `process.execPath` directory is not enough: version managers (nvm/fnm/volta)
 * expose Node through shim directories whose path differs from the resolved
 * binary, so `node` can still be found via a sibling PATH entry. Pointing PATH
 * at a single freshly created empty directory removes every Node resolution
 * source, deterministically reproducing the "node not found" launch environment.
 */
function nodeFreePathDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-node-path-'));
  return dir;
}

function makeConfig(): ServerBuildConfig {
  return {
    serverName: 'index-server',
    profile: 'enhanced',
    root: ROOT,
    port: 7777,
    host: '127.0.0.1',
    tls: false,
    mutation: true,
    logLevel: 'info',
  } as ServerBuildConfig;
}

function makePaths(): McpDataPaths {
  const under = (p: string): string => path.join(ROOT, p);
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
  } as McpDataPaths;
}

describe('MCP config — launchable with the Node directory stripped from PATH', () => {
  const strippedPath = nodeFreePathDir();
  // Run from a foreign cwd so Windows does not resolve `node` via the current
  // directory, mirroring a client launched from the user's home.
  const foreignCwd = os.tmpdir();
  const strippedEnv = { ...process.env, PATH: strippedPath, Path: strippedPath };

  it('(guard) bare `node` is genuinely unlaunchable once its directory is off PATH', () => {
    const result = spawnSync('node', ['--version'], {
      cwd: foreignCwd,
      env: strippedEnv,
      encoding: 'utf8',
      shell: false,
    });
    // ENOENT (error set) or a non-zero status — either way, NOT a clean launch.
    const launchedCleanly = !result.error && result.status === 0;
    expect(
      launchedCleanly,
      'Test isolation broken: bare `node` still resolved with the Node dir removed ' +
        'from PATH (another PATH entry must contain node). The launch assertion ' +
        'below would be meaningless. Tighten pathWithoutNodeDir().',
    ).toBe(false);
  });

  it.each(['copilot-cli', 'claude', 'vscode-global'] as const)(
    '%s command launches Node without PATH (absolute, existing binary)',
    (format) => {
      const entry = buildServerEntry(format, makeConfig(), makePaths());

      // Contract: command is an absolute path to an existing Node binary.
      expect(path.isAbsolute(entry.command), `command not absolute: ${entry.command}`).toBe(true);
      expect(fs.existsSync(entry.command), `command does not exist: ${entry.command}`).toBe(true);

      // Behavioral proof: it actually runs with the Node dir off PATH. `node
      // --version` is a fast, deterministic launch that exercises ONLY command
      // resolution (no server boot), which is the property under test.
      const result = spawnSync(entry.command, ['--version'], {
        cwd: foreignCwd,
        env: strippedEnv,
        encoding: 'utf8',
        shell: false,
      });
      expect(result.error, `spawn failed for ${format}: ${result.error?.message}`).toBeUndefined();
      expect(result.status, `non-zero exit for ${format}: ${result.stderr}`).toBe(0);
      expect(result.stdout.trim()).toMatch(/^v\d+\.\d+\.\d+/);
    },
  );
});
