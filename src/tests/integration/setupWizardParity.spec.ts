import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const WIZARD_SCRIPT = path.join(ROOT, 'scripts', 'build', 'setup-wizard.mjs');
const SERVER_ENTRY = path.join(ROOT, 'dist', 'server', 'index-server.js');
const PROFILES = ['default', 'enhanced', 'experimental'] as const;
const TARGETS = ['vscode', 'copilot-cli', 'claude'] as const;

function runNode(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
}

function configPath(target: typeof TARGETS[number], root: string, home: string): string {
  if (target === 'vscode') return path.join(root, '.vscode', 'mcp.json');
  if (target === 'copilot-cli') return path.join(home, '.copilot', 'mcp-config.json');
  if (process.platform === 'win32') return path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

describe('setup wizard and mcpConfig CLI shared write path parity', () => {
  it.each(PROFILES.flatMap(profile => TARGETS.map(target => [profile, target] as const)))(
    'produces byte-identical %s %s config from --setup and --mcp-upsert',
    (profile, target) => {
      const setupRoot = fs.mkdtempSync(path.join(os.tmpdir(), `setup-parity-${profile}-${target}-`));
      const cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), `cli-parity-${profile}-${target}-`));
      const setupHome = fs.mkdtempSync(path.join(os.tmpdir(), `setup-parity-home-${profile}-${target}-`));
      const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), `cli-parity-home-${profile}-${target}-`));
      try {
        const setup = runNode([
          WIZARD_SCRIPT,
          '--non-interactive',
          '--profile',
          profile,
          '--root',
          setupRoot,
          '--target',
          target,
          '--write',
          '--no-deploy',
          '--no-preview',
        ], { HOME: setupHome, USERPROFILE: setupHome, APPDATA: path.join(setupHome, 'AppData', 'Roaming') });
        expect(setup.status, `${setup.stdout}\n${setup.stderr}`).toBe(0);

        const cli = runNode([
          SERVER_ENTRY,
          '--mcp-upsert',
          '--target',
          target,
          '--from-profile',
          profile,
          '--json',
        ], {
          INDEX_SERVER_MCP_CONFIG_ROOT: cliRoot,
          HOME: cliHome,
          USERPROFILE: cliHome,
          APPDATA: path.join(cliHome, 'AppData', 'Roaming'),
        });
        expect(cli.status, `${cli.stdout}\n${cli.stderr}`).toBe(0);

        expect(fs.readFileSync(configPath(target, cliRoot, cliHome), 'utf8'))
          .toBe(fs.readFileSync(configPath(target, setupRoot, setupHome), 'utf8'));
      } finally {
        fs.rmSync(setupRoot, { recursive: true, force: true });
        fs.rmSync(cliRoot, { recursive: true, force: true });
        fs.rmSync(setupHome, { recursive: true, force: true });
        fs.rmSync(cliHome, { recursive: true, force: true });
      }
    },
    45_000,
  );
});
