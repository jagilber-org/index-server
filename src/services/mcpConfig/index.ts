import fs from 'fs';
import path from 'path';
import { createBackup, restoreBackup } from './backup';
import { buildServerEntry, getServerMap, parseConfigText, readConfigFile, removeConfigText, renderConfig, resolveServerLaunch, upsertConfigText, type McpServerEntry, type ServerBuildConfig } from './formats';
import { buildEnvCatalog, resolveDataPaths, type McpProfile } from './flagCatalog';
import { resolveConfigTargets, type McpClientTarget, type McpConfigFormat, type McpScope, type McpTargetInfo } from './paths';
import { assertValidConfigObject, validateConfigObject, type ValidationResult } from './validate';
import { atomicWriteText } from './backup';

export type { McpClientTarget, McpConfigFormat, McpScope, McpTargetInfo, McpServerEntry, ServerBuildConfig, ValidationResult, McpProfile };
export { buildEnvCatalog, resolveConfigTargets, resolveDataPaths, resolveServerLaunch };

export interface McpOperationOptions {
  target?: McpClientTarget;
  targets?: McpClientTarget[];
  scope?: McpScope;
  root?: string;
  name?: string;
  profile?: McpProfile;
  port?: number;
  host?: string;
  tls?: boolean;
  mutation?: boolean;
  logLevel?: string;
  env?: Record<string, string>;
  dryRun?: boolean;
  backup?: string;
  /**
   * Pre-resolved target. When supplied, bypasses target/scope resolution.
   * Required for callers that need to write to a specific flavor (e.g. both
   * VS Code stable and Insiders), since `resolveConfigTargets` may return
   * multiple `vscode-global` entries.
   */
  targetInfo?: McpTargetInfo;
}

export interface McpOperationResult {
  ok: boolean;
  action: string;
  target: McpClientTarget;
  format: McpConfigFormat;
  path: string;
  name?: string;
  server?: McpServerEntry | null;
  servers?: string[];
  validation?: ValidationResult;
  backupPath?: string;
  dryRun?: boolean;
}

function firstTarget(options: McpOperationOptions): McpTargetInfo {
  if (options.targetInfo) return options.targetInfo;
  return resolveConfigTargets({
    target: options.target,
    targets: options.targets,
    scope: options.scope,
    root: options.root,
  })[0];
}

function defaultName(options: McpOperationOptions): string {
  return options.name ?? 'index-server';
}

function buildConfig(options: McpOperationOptions): ServerBuildConfig {
  const profile = options.profile ?? 'default';
  const tls = options.tls ?? (profile === 'enhanced' || profile === 'experimental');
  return {
    profile,
    root: path.resolve(options.root ?? process.env.INDEX_SERVER_MCP_CONFIG_ROOT ?? process.cwd()),
    port: options.port ?? 8787,
    host: options.host ?? '127.0.0.1',
    tls,
    mutation: options.mutation ?? true,
    logLevel: options.logLevel ?? (profile === 'experimental' ? 'debug' : 'info'),
    serverName: defaultName(options),
  };
}

function readExistingText(filePath: string, format: McpConfigFormat): string {
  if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
  return renderConfig(format, '__placeholder__', {
    command: 'node',
    args: ['dist/server/index-server.js'],
  }).split('__placeholder__').join('index-server');
}

export function listServers(options: McpOperationOptions = {}): McpOperationResult {
  const target = firstTarget(options);
  const config = readConfigFile(target.format, target.path);
  const servers = Object.keys(getServerMap(config, target.format));
  return { ok: true, action: 'list', ...target, servers };
}

export function getServer(options: McpOperationOptions = {}): McpOperationResult {
  const target = firstTarget(options);
  const config = readConfigFile(target.format, target.path);
  const server = getServerMap(config, target.format)[defaultName(options)] ?? null;
  return { ok: true, action: 'get', ...target, name: defaultName(options), server };
}

export function upsertServer(options: McpOperationOptions = {}): McpOperationResult {
  const target = firstTarget(options);
  const config = buildConfig(options);
  const paths = resolveDataPaths(config.root);
  const entry = buildServerEntry(target.format, config, paths, options.env);
  const existingText = fs.existsSync(target.path) ? fs.readFileSync(target.path, 'utf8') : '';
  if (existingText) assertValidConfigObject(target.format, parseConfigText(target.format, existingText), 'read');
  const nextText = upsertConfigText(target.format, existingText, config.serverName, entry);
  const nextConfig = parseConfigText(target.format, nextText);
  assertValidConfigObject(target.format, nextConfig, 'write');
  if (!options.dryRun) {
    const backup = createBackup(target.path, 'upsert', config.serverName);
    atomicWriteText(target.path, nextText);
    assertValidConfigObject(target.format, readConfigFile(target.format, target.path), 'post-write');
    return { ok: true, action: 'upsert', ...target, name: config.serverName, server: entry, backupPath: backup?.backupPath };
  }
  return { ok: true, action: 'upsert', ...target, name: config.serverName, server: entry, dryRun: true };
}

export function removeServer(options: McpOperationOptions = {}): McpOperationResult {
  const target = firstTarget(options);
  const name = defaultName(options);
  const existingText = readExistingText(target.path, target.format);
  assertValidConfigObject(target.format, parseConfigText(target.format, existingText), 'read');
  const nextText = removeConfigText(target.format, existingText, name);
  assertValidConfigObject(target.format, parseConfigText(target.format, nextText), 'write');
  if (!options.dryRun) {
    const backup = createBackup(target.path, 'remove', name);
    atomicWriteText(target.path, nextText);
    assertValidConfigObject(target.format, readConfigFile(target.format, target.path), 'post-write');
    return { ok: true, action: 'remove', ...target, name, backupPath: backup?.backupPath };
  }
  return { ok: true, action: 'remove', ...target, name, dryRun: true };
}

export function restoreLatestBackup(options: McpOperationOptions = {}): McpOperationResult {
  const target = firstTarget(options);
  const restored = restoreBackup(target.path, options.backup);
  assertValidConfigObject(target.format, readConfigFile(target.format, target.path), 'restore');
  return { ok: true, action: 'restore', ...target, backupPath: restored.backupPath };
}

export function restoreServer(options: McpOperationOptions = {}): McpOperationResult {
  return restoreLatestBackup(options);
}

export function validateFile(options: McpOperationOptions = {}): McpOperationResult {
  const target = firstTarget(options);
  const config = readConfigFile(target.format, target.path);
  const validation = validateConfigObject(target.format, config);
  return { ok: validation.ok, action: 'validate', ...target, validation };
}

export function renderServerConfigForTarget(target: McpTargetInfo, options: McpOperationOptions = {}): string {
  const config = buildConfig({ ...options, target: target.target, scope: target.format === 'vscode-global' ? 'global' : options.scope });
  const paths = resolveDataPaths(config.root);
  const entry = buildServerEntry(target.format, config, paths, options.env);
  return renderConfig(target.format, config.serverName, entry);
}

export function writeGeneratedConfig(filePath: string, content: string): void {
  atomicWriteText(filePath, content);
}
