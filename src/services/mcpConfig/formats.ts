import fs from 'fs';
import path from 'path';
import child_process from 'child_process';
import { applyJsoncEdit, parseJsonc } from './jsoncEdit';
import { activeEnvFromCatalog, buildEnvCatalog, McpDataPaths, McpProfileConfig, toForwardSlashes } from './flagCatalog';
import type { McpConfigFormat } from './paths';

export interface McpServerEntry {
  type?: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  tools?: string[];
}

export interface ServerBuildConfig extends McpProfileConfig {
  serverName: string;
}

export function rootKeyForFormat(format: McpConfigFormat): 'servers' | 'mcpServers' {
  return format === 'vscode' || format === 'vscode-global' ? 'servers' : 'mcpServers';
}

export function emptyConfigForFormat(format: McpConfigFormat): Record<string, unknown> {
  const rootKey = rootKeyForFormat(format);
  const value: Record<string, unknown> = { [rootKey]: {} };
  if (rootKey === 'servers') value.inputs = [];
  return value;
}

export function parseConfigText(format: McpConfigFormat, text: string): Record<string, unknown> {
  if (text.trim().length === 0) return emptyConfigForFormat(format);
  return format === 'vscode' || format === 'vscode-global'
    ? parseJsonc(text)
    : JSON.parse(text) as Record<string, unknown>;
}

export function readConfigFile(format: McpConfigFormat, filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return emptyConfigForFormat(format);
  return parseConfigText(format, fs.readFileSync(filePath, 'utf8'));
}

export function getServerMap(config: Record<string, unknown>, format: McpConfigFormat): Record<string, McpServerEntry> {
  const rootKey = rootKeyForFormat(format);
  const servers = config[rootKey];
  if (servers === undefined) return {};
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    throw new Error(`Invalid MCP config: ${rootKey} must be an object`);
  }
  return servers as Record<string, McpServerEntry>;
}

/**
 * Returns true when `p` lies under an npx ephemeral cache (e.g.
 * `~/.npm/_npx/<hash>/...` on POSIX or `%LocalAppData%\npm-cache\_npx\<hash>\...`
 * on Windows). Such paths are not safe to bake into an mcp.json: npx may evict
 * them between wizard run and first MCP-client launch.
 */
export function isEphemeralNpxPath(p: string): boolean {
  const normalized = toForwardSlashes(p);
  return /\/_npx\//i.test(normalized);
}

/**
 * Probes whether `npx` is reachable from the current environment. Used by
 * `resolveServerLaunch` (issue #386) to avoid baking a `command: 'npx'` entry
 * into `mcp.json` when the host cannot actually launch npx (offline machine,
 * stripped PATH, locked-down CI runner). We spawn `npx --version` rather than
 * parsing PATH ourselves so that platform-specific resolution (PATHEXT, .cmd
 * shims, shell builtins) is handled by the OS.
 */
export function isNpxReachable(): boolean {
  try {
    // Pass the full command as a single shell string to avoid the DEP0190
    // shell+args concatenation warning. Args are static (`--version`) and
    // never include user input, so this is safe.
    const result = child_process.spawnSync('npx --version', {
      stdio: 'ignore',
      shell: true,
      timeout: 5000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function resolveServerLaunch(config: { root: string }): { command: string; args: string[]; cwd?: string; source: 'local' | 'packaged' | 'npx' } {
  const packageRoot = path.resolve(__dirname, '..', '..', '..');
  const entryRelative = path.join('dist', 'server', 'index-server.js');
  const localEntry = path.join(config.root, entryRelative);
  const packagedEntry = path.join(packageRoot, entryRelative);
  if (fs.existsSync(localEntry)) {
    return { command: 'node', args: [toForwardSlashes(entryRelative)], cwd: config.root, source: 'local' };
  }
  // Reject npx ephemeral cache locations — those paths are not durable. Fall
  // through to the `npx` launch form, which re-resolves the package on each
  // start. See setup-wizard RCA: https://github.com/jagilber-dev/index-server
  if (fs.existsSync(packagedEntry) && !isEphemeralNpxPath(packagedEntry)) {
    return { command: 'node', args: [toForwardSlashes(packagedEntry)], source: 'packaged' };
  }
  // Pre-validation gate (issue #386): only return the npx descriptor when npx
  // is actually reachable. Otherwise we'd write an unlaunchable mcp.json.
  if (isNpxReachable()) {
    return { command: 'npx', args: ['-y', '@jagilber-org/index-server'], source: 'npx' };
  }
  throw new Error(
    `setup-wizard: no viable launch mode for index-server. Tried:\n` +
      `  - local entry-point:    ${toForwardSlashes(localEntry)} (missing)\n` +
      `  - packaged entry-point: ${toForwardSlashes(packagedEntry)} (missing)\n` +
      `  - npx fallback:         not reachable on PATH\n` +
      `Remediation: run \`npm install\` and \`npm run build\` in the repo root, ` +
      `reinstall \`@jagilber-org/index-server\`, or pass \`--root <path>\` pointing ` +
      `at a directory containing \`${toForwardSlashes(entryRelative)}\`.`,
  );
}

export function buildServerEntry(format: McpConfigFormat, config: ServerBuildConfig, paths: McpDataPaths, envOverrides: Record<string, string> = {}): McpServerEntry {
  const launch = resolveServerLaunch(config);
  const catalog = buildEnvCatalog(config, paths);
  const env = { ...activeEnvFromCatalog(catalog), ...envOverrides };
  const entry: McpServerEntry = {
    command: launch.command,
    args: launch.args,
    env,
  };
  if (format === 'vscode' || format === 'vscode-global') entry.type = 'stdio';
  if (format === 'vscode' && launch.cwd) entry.cwd = toForwardSlashes(launch.cwd);
  // Every non-workspace format must carry an ABSOLUTE node entry path. Only the
  // repo-scoped `vscode` format has a workspace `cwd` to anchor a relative
  // `dist/server/index-server.js`; for `vscode-global`, `copilot-cli`, and
  // `claude` the launching client's working directory is the user's home (or
  // arbitrary), and Copilot CLI / Claude Desktop do not reliably honor a `cwd`
  // field. A relative path there is unlaunchable ("Cannot find module
  // dist/server/index-server.js"). Anchor to config.root (the user-chosen
  // install root), never to __dirname — under npx __dirname resolves into the
  // ephemeral `_npx/<hash>/` cache. See setup-wizard RCA.
  if (
    (format === 'vscode-global' || format === 'copilot-cli' || format === 'claude') &&
    launch.command === 'node'
  ) {
    const firstArg = launch.args[0] ?? '';
    entry.args = [path.isAbsolute(firstArg)
      ? toForwardSlashes(firstArg)
      : toForwardSlashes(path.resolve(launch.cwd ?? config.root, firstArg))];
    // Pin the node binary to an ABSOLUTE path. A bare `node` command is resolved
    // by the launching client (VS Code, Copilot CLI, Claude Desktop) against the
    // PATH of ITS OWN process, inherited at launch time — NOT the user's current
    // shell. A client started before Node was added to PATH, or from a launcher
    // with a stripped environment, fails with "command 'node' not found" even
    // though `node` runs fine in a fresh terminal. `process.execPath` is the
    // absolute path of the Node binary currently running the wizard, so it is
    // guaranteed to exist and be launchable on this machine. The repo-scoped
    // `vscode` (workspace) format deliberately keeps bare `node` above so a
    // committed workspace config stays portable across machines/contributors.
    entry.command = toForwardSlashes(process.execPath);
    // vscode-global additionally pins cwd; copilot-cli/claude rely solely on the
    // absolute args path (self-sufficient regardless of client cwd support).
    if (format === 'vscode-global') entry.cwd = toForwardSlashes(config.root);
  }
  return entry;
}

export function renderConfig(format: McpConfigFormat, serverName: string, entry: McpServerEntry): string {
  const config = emptyConfigForFormat(format);
  const rootKey = rootKeyForFormat(format);
  (config[rootKey] as Record<string, McpServerEntry>)[serverName] = entry;
  return format === 'vscode' || format === 'vscode-global'
    ? JSON.stringify(config, null, 2)
    : `${JSON.stringify(config, null, 2)}\n`;
}

export function upsertConfigText(format: McpConfigFormat, existingText: string, serverName: string, entry: McpServerEntry): string {
  if (format === 'vscode' || format === 'vscode-global') {
    const base = existingText.trim().length > 0 ? existingText : JSON.stringify(emptyConfigForFormat(format), null, 2);
    return applyJsoncEdit(base, [rootKeyForFormat(format), serverName], entry);
  }
  const config = parseConfigText(format, existingText);
  const rootKey = rootKeyForFormat(format);
  const servers = getServerMap(config, format);
  servers[serverName] = entry;
  config[rootKey] = servers;
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function removeConfigText(format: McpConfigFormat, existingText: string, serverName: string): string {
  if (format === 'vscode' || format === 'vscode-global') {
    const base = existingText.trim().length > 0 ? existingText : JSON.stringify(emptyConfigForFormat(format), null, 2);
    return applyJsoncEdit(base, [rootKeyForFormat(format), serverName], undefined);
  }
  const config = parseConfigText(format, existingText);
  const rootKey = rootKeyForFormat(format);
  const servers = getServerMap(config, format);
  delete servers[serverName];
  config[rootKey] = servers;
  return `${JSON.stringify(config, null, 2)}\n`;
}
