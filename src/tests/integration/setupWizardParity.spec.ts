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
      // Parity check: identical logical inputs (root, home, profile, target) must
      // produce byte-identical config from both write paths. Root/home are shared
      // because some env values (e.g. TLS cert paths) are derived from the root,
      // so divergent temp dirs would not be byte-identical even when behavior is
      // correct. We snapshot the setup-wizard output, then let the CLI overwrite
      // and compare against the snapshot.
      const sharedRoot = fs.mkdtempSync(path.join(os.tmpdir(), `parity-${profile}-${target}-`));
      const sharedHome = fs.mkdtempSync(path.join(os.tmpdir(), `parity-home-${profile}-${target}-`));
      try {
        const setup = runNode([
          WIZARD_SCRIPT,
          '--non-interactive',
          '--profile',
          profile,
          '--root',
          sharedRoot,
          '--target',
          target,
          '--write',
          '--no-deploy',
          '--no-preview',
        ], { HOME: sharedHome, USERPROFILE: sharedHome, APPDATA: path.join(sharedHome, 'AppData', 'Roaming') });
        expect(setup.status, `${setup.stdout}\n${setup.stderr}`).toBe(0);
        const setupOutput = fs.readFileSync(configPath(target, sharedRoot, sharedHome), 'utf8');

        const cli = runNode([
          SERVER_ENTRY,
          '--mcp-upsert',
          '--target',
          target,
          '--from-profile',
          profile,
          '--json',
        ], {
          INDEX_SERVER_MCP_CONFIG_ROOT: sharedRoot,
          HOME: sharedHome,
          USERPROFILE: sharedHome,
          APPDATA: path.join(sharedHome, 'AppData', 'Roaming'),
        });
        expect(cli.status, `${cli.stdout}\n${cli.stderr}`).toBe(0);

        expect(fs.readFileSync(configPath(target, sharedRoot, sharedHome), 'utf8')).toBe(setupOutput);
      } finally {
        fs.rmSync(sharedRoot, { recursive: true, force: true });
        fs.rmSync(sharedHome, { recursive: true, force: true });
      }
    },
    45_000,
  );
});
