import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readConfig } from '../helpers/mcpConfig';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVER_ENTRY = path.join(ROOT, 'dist', 'server', 'index-server.js');

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [SERVER_ENTRY, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 20_000,
  });
}

function parseJsonOutput(result: ReturnType<typeof runCli>): Record<string, unknown> {
  expect(result.error, `${result.stdout}\n${result.stderr}`).toBeUndefined();
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

describe('mcpConfig CLI subcommands', () => {
  it.each(['vscode', 'copilot-cli', 'claude'] as const)(
    'supports --mcp-upsert/list/get/validate/remove/restore with --json for %s',
    target => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `mcp-cli-${target}-`));
      const home = fs.mkdtempSync(path.join(os.tmpdir(), `mcp-cli-home-${target}-`));
      const env = {
        INDEX_SERVER_MCP_CONFIG_ROOT: root,
        INDEX_SERVER_MCP_BACKUP_RETAIN: '3',
        HOME: home,
        USERPROFILE: home,
        APPDATA: path.join(home, 'AppData', 'Roaming'),
      };
      try {
        const upsert = runCli(['--mcp-upsert', '--target', target, '--name', 'index-server', '--from-profile', 'default', '--env', 'INDEX_SERVER_MUTATION=1', '--json'], env);
        expect(upsert.status, `${upsert.stdout}\n${upsert.stderr}`).toBe(0);
        expect(parseJsonOutput(upsert).action).toBe('upsert');

        const list = runCli(['--mcp-list', '--target', target, '--json'], env);
        expect(list.status, `${list.stdout}\n${list.stderr}`).toBe(0);
        expect(parseJsonOutput(list).servers).toEqual(['index-server']);

        const get = runCli(['--mcp-get', '--target', target, '--name', 'index-server', '--json'], env);
        expect(get.status, `${get.stdout}\n${get.stderr}`).toBe(0);
        expect(JSON.stringify(parseJsonOutput(get))).toContain('INDEX_SERVER_MUTATION');

        const validate = runCli(['--mcp-validate', '--target', target, '--json'], env);
        expect(validate.status, `${validate.stdout}\n${validate.stderr}`).toBe(0);
        expect(parseJsonOutput(validate).ok).toBe(true);

        const remove = runCli(['--mcp-remove', '--target', target, '--name', 'index-server', '--json'], env);
        expect(remove.status, `${remove.stdout}\n${remove.stderr}`).toBe(0);
        expect(parseJsonOutput(remove).action).toBe('remove');

        const restore = runCli(['--mcp-restore', '--target', target, '--json'], env);
        expect(restore.status, `${restore.stdout}\n${restore.stderr}`).toBe(0);
        expect(parseJsonOutput(restore).action).toBe('restore');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
      }
    },
  );

  it('supports VS Code global target through --scope global', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cli-global-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cli-global-home-'));
    const appData = path.join(home, 'AppData', 'Roaming');
    const env = { INDEX_SERVER_MCP_CONFIG_ROOT: root, HOME: home, USERPROFILE: home, APPDATA: appData };
    try {
      const upsert = runCli(['--mcp-upsert', '--target', 'vscode', '--scope', 'global', '--json'], env);
      expect(upsert.status, `${upsert.stdout}\n${upsert.stderr}`).toBe(0);
      const configPath = process.platform === 'win32'
        ? path.join(appData, 'Code', 'User', 'mcp.json')
        : path.join(home, '.config', 'Code', 'User', 'mcp.json');
      expect(readConfig(configPath, 'vscode-global')).toHaveProperty('servers');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('does not mutate disk when --dry-run is used', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cli-dry-run-'));
    try {
      const result = runCli(['--mcp-upsert', '--target', 'vscode', '--dry-run', '--json'], {
        INDEX_SERVER_MCP_CONFIG_ROOT: root,
      });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(parseJsonOutput(result).dryRun).toBe(true);
      expect(fs.existsSync(path.join(root, '.vscode', 'mcp.json'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns non-zero JSON errors for invalid CLI input and malformed config', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cli-invalid-'));
    try {
      const badEnv = runCli(['--mcp-upsert', '--target', 'vscode', '--env', 'NOT_A_PAIR', '--json'], {
        INDEX_SERVER_MCP_CONFIG_ROOT: root,
      });
      expect(badEnv.status).not.toBe(0);
      expect(parseJsonOutput(badEnv).ok).toBe(false);

      const mcpPath = path.join(root, '.vscode', 'mcp.json');
      fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
      fs.writeFileSync(mcpPath, '{ "servers": {', 'utf8');
      const validate = runCli(['--mcp-validate', '--target', 'vscode', '--json'], {
        INDEX_SERVER_MCP_CONFIG_ROOT: root,
      });
      expect(validate.status).not.toBe(0);
      expect(parseJsonOutput(validate).ok).toBe(false);
      expect(fs.readFileSync(mcpPath, 'utf8')).toBe('{ "servers": {');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
