import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { McpProfile, McpTarget, assertConfigValid, bootFromConfig, getServerEntry, readConfig } from '../helpers/mcpConfig';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVER_ENTRY = path.join(ROOT, 'dist', 'server', 'index-server.js');
const PROFILES: McpProfile[] = ['default', 'enhanced', 'experimental'];
const TARGETS: McpTarget[] = ['vscode', 'vscode-global', 'copilot-cli', 'claude'];

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [SERVER_ENTRY, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
}

function targetConfigPath(target: McpTarget, root: string, home: string): string {
  if (target === 'vscode') return path.join(root, '.vscode', 'mcp.json');
  if (target === 'vscode-global') {
    return process.platform === 'win32'
      ? path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json')
      : path.join(home, '.config', 'Code', 'User', 'mcp.json');
  }
  if (target === 'copilot-cli') return path.join(home, '.copilot', 'mcp-config.json');
  if (process.platform === 'win32') return path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

describe('mcpConfig generated config CRUD and behavioral boot matrix', () => {
  it.each(PROFILES.flatMap(profile => TARGETS.map(target => [profile, target] as const)))(
    'upsert/remove/restore and boots from generated file for %s x %s',
    async (profile, target) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `mcp-roundtrip-${profile}-${target}-`));
      const home = fs.mkdtempSync(path.join(os.tmpdir(), `mcp-roundtrip-home-${profile}-${target}-`));
      const env = {
        INDEX_SERVER_MCP_CONFIG_ROOT: root,
        HOME: home,
        USERPROFILE: home,
        APPDATA: path.join(home, 'AppData', 'Roaming'),
      };
      try {
        const cliTarget = target === 'vscode-global' ? 'vscode' : target;
        const scopeArgs = target === 'vscode-global' ? ['--scope', 'global'] : [];
        const upsert = runCli(['--mcp-upsert', '--target', cliTarget, ...scopeArgs, '--from-profile', profile, '--json'], env);
        expect(upsert.status, `${upsert.stdout}\n${upsert.stderr}`).toBe(0);

        const configPath = targetConfigPath(target, root, home);
        assertConfigValid(configPath, target);
        const config = readConfig(configPath, target);
        expect(getServerEntry(config, target).env?.INDEX_SERVER_PROFILE).toBe(profile);
        await bootFromConfig({ configPath, serverName: 'index-server', format: target, timeoutMs: 25_000 });

        const beforeRemove = fs.readFileSync(configPath, 'utf8');
        const remove = runCli(['--mcp-remove', '--target', cliTarget, ...scopeArgs, '--name', 'index-server', '--json'], env);
        expect(remove.status, `${remove.stdout}\n${remove.stderr}`).toBe(0);
        const removedConfig = readConfig(configPath, target);
        const rootKey = target === 'vscode' || target === 'vscode-global' ? 'servers' : 'mcpServers';
        expect(Object.keys(removedConfig[rootKey] as Record<string, unknown>)).toEqual([]);

        const restore = runCli(['--mcp-restore', '--target', cliTarget, ...scopeArgs, '--json'], env);
        expect(restore.status, `${restore.stdout}\n${restore.stderr}`).toBe(0);
        expect(fs.readFileSync(configPath, 'utf8')).toBe(beforeRemove);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
