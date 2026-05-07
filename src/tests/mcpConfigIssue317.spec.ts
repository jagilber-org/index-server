import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  McpProfile,
  McpTarget,
  assertConfigValid,
  assertLaunchSpec,
  bootFromConfig,
  getServerEntry,
  readConfig,
} from './helpers/mcpConfig';

const ROOT = path.resolve(__dirname, '..', '..');
const WIZARD_SCRIPT = path.join(ROOT, 'scripts', 'build', 'setup-wizard.mjs');
const SERVER_ENTRY = path.join(ROOT, 'dist', 'server', 'index-server.js');
const MCP_CONFIG_DIR = path.join(ROOT, 'src', 'services', 'mcpConfig');
const PROFILES: McpProfile[] = ['default', 'enhanced', 'experimental'];
const TARGETS: McpTarget[] = ['vscode', 'vscode-global', 'copilot-cli', 'claude'];
const MCP_SUBCOMMANDS = [
  '--mcp-list',
  '--mcp-get',
  '--mcp-upsert',
  '--mcp-remove',
  '--mcp-restore',
  '--mcp-validate',
] as const;

const acceptanceChecklist = [
  'CRUD works for all four target formats',
  'Every mutation writes rotated manifest backups and restore works',
  'No regex-based edits in the mcpConfig module',
  'No direct fs.writeFileSync against MCP configs outside mcpConfig',
  'VS Code JSONC comments are preserved including setup path',
  'All documented INDEX_SERVER_* flags are present in flagCatalog',
  'setup-wizard delegates MCP config writes to mcpConfig',
  '--setup and --mcp-upsert produce byte-identical output for same profile',
  'CLI subcommands are documented and surfaced in --help',
  'Three-layer reusable test helpers exist',
  'CRUD round trip boots index-server for every profile x target',
  'Ad-hoc CI scripts are deleted and workflow invokes vitest mcpConfig tests',
  'Behavioral tests assert no orphan child processes',
  'Existing setup-wizard E2E and unit suites stay green',
];

function runNode(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}) {
  return spawnSync(process.execPath, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    timeout: options.timeout ?? 10_000,
  });
}

let cliHelpCache: string | undefined;
function cliHelp(): string {
  if (cliHelpCache !== undefined) return cliHelpCache;
  const result = runNode([SERVER_ENTRY, '--help'], { timeout: 5_000 });
  cliHelpCache = `${result.stdout}\n${result.stderr}`;
  expect(result.error, cliHelpCache).toBeUndefined();
  expect(result.status, cliHelpCache).toBe(0);
  return cliHelpCache;
}

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFilesRecursive(fullPath) : [fullPath];
  });
}

function extractIndexServerFlags(text: string): Set<string> {
  return new Set(text.match(/\bINDEX_SERVER_[A-Z0-9_]+\b/g) ?? []);
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

describe('Issue #317 acceptance checklist', () => {
  it('captures every issue acceptance area before implementation', () => {
    expect(acceptanceChecklist).toHaveLength(14);
    expect(acceptanceChecklist).toEqual(expect.arrayContaining([
      expect.stringContaining('CRUD'),
      expect.stringContaining('JSONC'),
      expect.stringContaining('flagCatalog'),
      expect.stringContaining('boot'),
      expect.stringContaining('Ad-hoc CI scripts'),
    ]));
  });
});

describe('Issue #317 mcpConfig module contract', () => {
  it('provides the required single-source-of-truth module files', () => {
    for (const file of ['index.ts', 'formats.ts', 'jsoncEdit.ts', 'backup.ts', 'validate.ts', 'paths.ts', 'flagCatalog.ts']) {
      expect(fs.existsSync(path.join(MCP_CONFIG_DIR, file)), `${file} is missing`).toBe(true);
    }
  });

  it('defines public CRUD, validation, and restore API exports', () => {
    const source = fs.readFileSync(path.join(MCP_CONFIG_DIR, 'index.ts'), 'utf8');
    for (const exported of ['listServers', 'getServer', 'upsertServer', 'removeServer', 'restoreLatestBackup', 'validateFile']) {
      expect(source).toContain(exported);
    }
  });

  it('ships schema files for all MCP formats and index-server env blocks', () => {
    for (const schema of [
      'mcp.vscode.schema.json',
      'mcp.copilot-cli.schema.json',
      'mcp.claude.schema.json',
      'mcp.indexServerEnv.schema.json',
    ]) {
      const schemaPath = path.join(ROOT, 'schemas', schema);
      expect(fs.existsSync(schemaPath), `${schema} is missing`).toBe(true);
      const text = fs.readFileSync(schemaPath, 'utf8');
      expect(text).toContain('"additionalProperties": false');
    }
  });
});

describe('Issue #317 JSONC, backup, and structural edit behavior', () => {
  it('preserves VS Code JSONC comments when --setup updates an existing config', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-317-jsonc-'));
    try {
      const mcpPath = path.join(root, '.vscode', 'mcp.json');
      fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
      fs.writeFileSync(mcpPath, [
        '{',
        '  // issue-317 workspace comment must survive',
        '  "servers": {',
        '    "existing-server": {',
        '      "type": "stdio",',
        '      "command": "node", // issue-317 inline comment must survive',
        '      "args": ["existing.js"],',
        '    },',
        '  },',
        '  "inputs": []',
        '}',
      ].join('\n'), 'utf8');

      const result = runNode([
        WIZARD_SCRIPT,
        '--non-interactive',
        '--root',
        root,
        '--target',
        'vscode',
        '--scope',
        'repo',
        '--write',
        '--no-deploy',
        '--no-preview',
      ]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

      const updated = fs.readFileSync(mcpPath, 'utf8');
      expect(updated).toContain('// issue-317 workspace comment must survive');
      expect(updated).toContain('// issue-317 inline comment must survive');
      assertConfigValid(mcpPath, 'vscode');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes manifest backups, rotates by retention, and restores latest backup via CLI', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-317-backup-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-317-home-'));
    try {
      for (let i = 0; i < 4; i += 1) {
        const result = runNode([
          SERVER_ENTRY,
          '--mcp-upsert',
          '--target',
          'vscode',
          '--name',
          'index-server',
          '--env',
          `INDEX_SERVER_ISSUE_317_COUNTER=${i}`,
          '--json',
        ], {
          env: {
            HOME: home,
            USERPROFILE: home,
            INDEX_SERVER_MCP_CONFIG_ROOT: root,
            INDEX_SERVER_MCP_BACKUP_RETAIN: '2',
          },
        });
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      }

      const backupDir = path.join(root, '.vscode', '.mcp-backups');
      const manifestPath = path.join(backupDir, 'manifest.json');
      expect(fs.existsSync(manifestPath), 'backup manifest is missing').toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { entries?: unknown[] };
      expect(manifest.entries).toHaveLength(2);

      const restore = runNode([
        SERVER_ENTRY,
        '--mcp-restore',
        '--target',
        'vscode',
        '--json',
      ], {
        env: {
          HOME: home,
          USERPROFILE: home,
          INDEX_SERVER_MCP_CONFIG_ROOT: root,
        },
      });
      expect(restore.status, `${restore.stdout}\n${restore.stderr}`).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('does not contain regex-based edit logic in the new mcpConfig module', () => {
    const moduleFiles = listFilesRecursive(MCP_CONFIG_DIR).filter(file => file.endsWith('.ts'));
    expect(moduleFiles.length, 'mcpConfig module files are missing').toBeGreaterThan(0);
    const offenders = moduleFiles
      .filter(file => file.endsWith('.ts'))
      .filter(file => {
        const source = fs.readFileSync(file, 'utf8');
        return source.includes('.replace(/') || source.includes('.match(/') || source.includes('.split(/');
      });
    expect(offenders).toEqual([]);
  });

  it('does not directly write MCP config files outside the shared module', () => {
    const inspectedRoots = ['scripts', path.join('src', 'server'), path.join('src', 'services')];
    const offenders = inspectedRoots.flatMap(root => listFilesRecursive(path.join(ROOT, root)))
      .filter(file => !file.startsWith(MCP_CONFIG_DIR))
      .filter(file => /\.(ts|js|mjs)$/.test(file))
      .filter(file => {
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
        return lines.some(line => line.includes('writeFileSync') && (
          line.includes('mcp.json') ||
          line.includes('mcp-config.json') ||
          line.includes('claude_desktop_config.json')
        ));
      });
    expect(offenders).toEqual([]);
  });
});

describe('Issue #317 flag catalog, docs, paths, and setup delegation', () => {
  it('covers every documented INDEX_SERVER_* flag in flagCatalog.ts', () => {
    const docs = ['configuration.md', 'runtime_config_mapping.md']
      .map(file => {
        const fullPath = path.join(ROOT, 'docs', file);
        expect(fs.existsSync(fullPath), `${file} is missing`).toBe(true);
        return fs.readFileSync(fullPath, 'utf8');
      })
      .join('\n');
    const documentedFlags = extractIndexServerFlags(docs);
    expect(documentedFlags.size).toBeGreaterThan(0);

    const catalogPath = path.join(MCP_CONFIG_DIR, 'flagCatalog.ts');
    expect(fs.existsSync(catalogPath), 'flagCatalog.ts is missing').toBe(true);
    const catalogFlags = extractIndexServerFlags(fs.readFileSync(catalogPath, 'utf8'));
    const missing = [...documentedFlags].filter(flag => !catalogFlags.has(flag));
    expect(missing).toEqual([]);
  });

  it('path resolver owns all supported target path decisions', () => {
    const pathsSource = fs.readFileSync(path.join(MCP_CONFIG_DIR, 'paths.ts'), 'utf8');
    for (const target of TARGETS) {
      expect(pathsSource).toContain(target);
    }
    expect(pathsSource).toContain('APPDATA');
    expect(pathsSource).toContain('.copilot');
    expect(pathsSource).toContain('claude_desktop_config.json');
  });

  it('setup-wizard delegates MCP config read/merge/write behavior to mcpConfig', () => {
    const wizardSource = fs.readFileSync(WIZARD_SCRIPT, 'utf8');
    expect(wizardSource).toContain('mcpConfig');
    expect(wizardSource).not.toContain('function writeConfigFile');
    expect(wizardSource).not.toContain('function parseJsonc');
    expect(wizardSource).not.toContain('function generateMcpJson');
    expect(wizardSource).not.toContain('function generateCopilotCliJson');
    expect(wizardSource).not.toContain('function generateClaudeDesktopJson');
  });
});

describe('Issue #317 CLI, docs, workflow, and parity', () => {
  it('surfaces all --mcp-* subcommands in CLI --help and docs/mcp_configuration.md', () => {
    const help = cliHelp();
    const docsPath = path.join(ROOT, 'docs', 'mcp_configuration.md');
    expect(fs.existsSync(docsPath), 'docs/mcp_configuration.md is missing').toBe(true);
    const docs = fs.readFileSync(docsPath, 'utf8');
    for (const subcommand of MCP_SUBCOMMANDS) {
      expect(help).toContain(subcommand);
      expect(docs).toContain(subcommand);
    }
    expect(docs).toContain('--setup');
    expect(docs).toContain('shared');
  });

  it('replaces ad-hoc setup wizard CI scripts and shell grep with vitest mcpConfig coverage', () => {
    expect(fs.existsSync(path.join(ROOT, 'scripts', 'ci', 'setup-wizard-config-validate.mjs'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'scripts', 'ci', 'setup-wizard-crud-test.mjs'))).toBe(false);

    const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'setup-wizard-e2e.yml'), 'utf8');
    expect(workflow).not.toContain('setup-wizard-config-validate.mjs');
    expect(workflow).not.toContain('setup-wizard-crud-test.mjs');
    expect(workflow).not.toContain('grep -q');
    expect(workflow).toContain('npm test -- mcpConfig');
  });

  it.each(PROFILES)('--setup and --mcp-upsert produce byte-identical vscode configs for %s profile', profile => {
    const setupRoot = fs.mkdtempSync(path.join(os.tmpdir(), `issue-317-setup-${profile}-`));
    const cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), `issue-317-cli-${profile}-`));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `issue-317-home-${profile}-`));
    try {
      const setup = runNode([
        WIZARD_SCRIPT,
        '--non-interactive',
        '--profile',
        profile,
        '--root',
        setupRoot,
        '--target',
        'vscode',
        '--write',
        '--no-deploy',
        '--no-preview',
      ], { env: { HOME: home, USERPROFILE: home } });
      expect(setup.status, `${setup.stdout}\n${setup.stderr}`).toBe(0);

      const cli = runNode([
        SERVER_ENTRY,
        '--mcp-upsert',
        '--target',
        'vscode',
        '--name',
        'index-server',
        '--from-profile',
        profile,
        '--json',
      ], {
        env: {
          HOME: home,
          USERPROFILE: home,
          INDEX_SERVER_MCP_CONFIG_ROOT: cliRoot,
        },
      });
      expect(cli.status, `${cli.stdout}\n${cli.stderr}`).toBe(0);

      const setupConfig = fs.readFileSync(path.join(setupRoot, '.vscode', 'mcp.json'), 'utf8');
      const cliConfig = fs.readFileSync(path.join(cliRoot, '.vscode', 'mcp.json'), 'utf8');
      expect(cliConfig).toBe(setupConfig);
    } finally {
      fs.rmSync(setupRoot, { recursive: true, force: true });
      fs.rmSync(cliRoot, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('Issue #317 generated config behavioral boot matrix', () => {
  it.each(PROFILES.flatMap(profile => TARGETS.map(target => [profile, target] as const)))(
    'boots index-server and completes CRUD from generated %s x %s config without test-side env overrides',
    async (profile, target) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `issue-317-${profile}-${target}-`));
      const home = fs.mkdtempSync(path.join(os.tmpdir(), `issue-317-home-${profile}-${target}-`));
      try {
        const cliTarget = target === 'vscode-global' ? 'vscode' : target;
        const cli = runNode([
          SERVER_ENTRY,
          '--mcp-upsert',
          '--target',
          cliTarget,
          '--name',
          'index-server',
          '--from-profile',
          profile,
          ...(target === 'vscode-global' ? ['--scope', 'global'] : []),
          '--json',
        ], {
          env: {
            HOME: home,
            USERPROFILE: home,
            APPDATA: path.join(home, 'AppData', 'Roaming'),
            INDEX_SERVER_MCP_CONFIG_ROOT: root,
          },
          timeout: 15_000,
        });
        expect(cli.status, `${cli.stdout}\n${cli.stderr}`).toBe(0);

        const configPath = targetConfigPath(target, root, home);
        assertConfigValid(configPath, target);
        const config = readConfig(configPath, target);
        const entry = getServerEntry(config, target);
        assertLaunchSpec(entry, { format: target, root });
        await bootFromConfig({ configPath, serverName: 'index-server', format: target, timeoutMs: 20_000 });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
      }
    },
    45_000,
  );
});
