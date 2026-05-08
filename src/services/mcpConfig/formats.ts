import fs from 'fs';
import path from 'path';
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

export function resolveServerLaunch(config: { root: string }): { command: string; args: string[]; cwd?: string; source: 'local' | 'packaged' | 'npx' } {
  const packageRoot = path.resolve(__dirname, '..', '..', '..');
  const entryRelative = path.join('dist', 'server', 'index-server.js');
  const localEntry = path.join(config.root, entryRelative);
  const packagedEntry = path.join(packageRoot, entryRelative);
  if (fs.existsSync(localEntry)) {
    return { command: 'node', args: [toForwardSlashes(entryRelative)], cwd: config.root, source: 'local' };
  }
  if (fs.existsSync(packagedEntry)) {
    return { command: 'node', args: [toForwardSlashes(packagedEntry)], source: 'packaged' };
  }
  return { command: 'npx', args: ['-y', '@jagilber-org/index-server'], source: 'npx' };
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
  if (format === 'vscode-global' && launch.command === 'node') {
    const firstArg = launch.args[0] ?? '';
    entry.args = [path.isAbsolute(firstArg) ? toForwardSlashes(firstArg) : toForwardSlashes(path.resolve(launch.cwd ?? config.root, firstArg))];
    entry.cwd = toForwardSlashes(path.resolve(__dirname, '..', '..', '..'));
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
