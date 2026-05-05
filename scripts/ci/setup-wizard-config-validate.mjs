#!/usr/bin/env node
/**
 * setup-wizard-config-validate.mjs — Validate generated MCP config files.
 *
 * Runs all target × profile combinations through the setup wizard in
 * non-interactive mode, then validates the generated config files for
 * structural correctness.
 *
 * Covers: vscode (JSONC), copilot-cli (JSON), claude (JSON),
 *         multi-target combined, merge/backup behavior, and VS Code global scope.
 *
 * Usage: node scripts/ci/setup-wizard-config-validate.mjs
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const WIZARD = path.join(ROOT, 'scripts', 'build', 'setup-wizard.mjs');
const tmpBase = path.join(os.tmpdir(), `wizard-validate-${Date.now()}`);

const TARGETS = ['vscode', 'copilot-cli', 'claude'];
const PROFILES = ['default', 'enhanced', 'experimental'];

let passed = 0;
let failed = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip JSONC comments and trailing commas, then parse. */
function parseJsonc(text) {
  const stripped = text
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

/** Normalize path separators to forward slashes for cross-platform comparison. */
function fwd(p) {
  return p.replace(/\\/g, '/');
}

function runWizard(args, envOverrides = {}) {
  const wizardArgs = Array.isArray(args) ? args : [];
  return execFileSync(
    process.execPath,
    [WIZARD, '--non-interactive', '--no-preview', ...wizardArgs],
    {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 30_000,
      env: { ...process.env, HOME: tmpBase, USERPROFILE: tmpBase, ...envOverrides },
    },
  ).toString();
}

/** Resolve where the wizard writes copilot-cli config (HOME-relative). */
function copilotConfigPath(home) {
  return path.join(home, '.copilot', 'mcp-config.json');
}

/** Resolve where the wizard writes claude config (platform-dependent). */
function claudeConfigPath(home) {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Claude', 'claude_desktop_config.json');
  }
  return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test suite 1: Each target × profile generates valid config
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ Config Generation Matrix ═══');

for (const profile of PROFILES) {
  for (const target of TARGETS) {
    const testDir = path.join(tmpBase, `${profile}-${target}`);
    const fakeHome = path.join(tmpBase, `home-${profile}-${target}`);
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(fakeHome, { recursive: true });

    console.log(`\n── ${profile} × ${target} ──`);

    try {
      runWizard(
        ['--profile', profile, '--target', target, '--root', testDir, '--write', '--no-deploy'],
        { HOME: fakeHome, USERPROFILE: fakeHome },
      );
    } catch (err) {
      console.error(`  ❌ Wizard execution failed: ${err.message}`);
      failed++;
      continue;
    }

    // --- .env validation ---
    runTest('.env generated', () => {
      const envPath = path.join(testDir, '.env');
      const genPath = path.join(testDir, '.env.generated');
      assert(
        fs.existsSync(envPath) || fs.existsSync(genPath),
        '.env or .env.generated must exist',
      );
      const content = fs.readFileSync(
        fs.existsSync(envPath) ? envPath : genPath,
        'utf8',
      );
      assert(content.includes('INDEX_SERVER_DASHBOARD'), 'Must contain INDEX_SERVER_DASHBOARD');
      assert(content.includes(`Profile: ${profile}`), `Must reference profile "${profile}"`);
    });

    // --- Target-specific config validation ---
    if (target === 'vscode') {
      const mcpPath = path.join(testDir, '.vscode', 'mcp.json');

      runTest('mcp.json exists', () => {
        assert(fs.existsSync(mcpPath), `${mcpPath} must exist`);
      });

      runTest('mcp.json structure (servers, cwd, relative args)', () => {
        const config = parseJsonc(fs.readFileSync(mcpPath, 'utf8'));
        assert(config.servers, 'Must have "servers" root key');
        const server = config.servers['index-server'];
        assert(server, 'Must have "index-server" entry');
        assert(server.type === 'stdio', 'type must be "stdio"');
        assert(server.cwd, 'Must have "cwd"');
        assert(server.command === 'node', 'command must be "node"');
        assert(Array.isArray(server.args), 'args must be array');
        // The wizard emits either a relative path (when launched from the
        // index-server source repo) or an absolute path (packaged install
        // case where dist/ lives outside the consumer project). Accept
        // both — only require the path to point at the entrypoint.
        const entry = String(server.args[0] ?? '');
        const normalized = entry.replace(/\\/g, '/');
        assert(
          normalized.endsWith('dist/server/index-server.js'),
          `args[0] must point at dist/server/index-server.js, got: ${server.args[0]}`,
        );
        assert(typeof server.env === 'object', 'Must have env object');
      });

      runTest('mcp.json profile env vars', () => {
        const config = parseJsonc(fs.readFileSync(mcpPath, 'utf8'));
        const env = config.servers['index-server'].env;
        assert(env.INDEX_SERVER_PROFILE === profile, `Profile must be "${profile}"`);

        if (profile === 'enhanced' || profile === 'experimental') {
          assert(
            env.INDEX_SERVER_SEMANTIC_ENABLED === '1',
            'Enhanced/experimental must enable semantic search',
          );
          assert(
            env.INDEX_SERVER_DASHBOARD_TLS === '1',
            'Enhanced/experimental must enable TLS',
          );
        }
        if (profile === 'experimental') {
          assert(
            env.INDEX_SERVER_STORAGE_BACKEND === 'sqlite',
            'Experimental must use sqlite backend',
          );
        }
      });
    }

    if (target === 'copilot-cli') {
      const mcpPath = copilotConfigPath(fakeHome);

      runTest('mcp-config.json exists', () => {
        assert(fs.existsSync(mcpPath), `${mcpPath} must exist`);
      });

      runTest('mcp-config.json structure (mcpServers, absolute args)', () => {
        const config = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
        assert(config.mcpServers, 'Must have "mcpServers" root key');
        const server = config.mcpServers['index-server'];
        assert(server, 'Must have "index-server" entry');
        assert(server.command === 'node', 'command must be "node"');
        assert(Array.isArray(server.args), 'args must be array');
        assert(
          path.isAbsolute(server.args[0]),
          `args[0] must be absolute path, got: ${server.args[0]}`,
        );
        assert(
          fwd(server.args[0]).includes('dist/server/index-server.js'),
          `args must reference index-server.js, got: ${server.args[0]}`,
        );
        assert(typeof server.env === 'object', 'Must have env object');
      });
    }

    if (target === 'claude') {
      const mcpPath = claudeConfigPath(fakeHome);

      runTest('claude config exists', () => {
        assert(fs.existsSync(mcpPath), `${mcpPath} must exist`);
      });

      runTest('claude config structure (mcpServers, absolute args)', () => {
        const config = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
        assert(config.mcpServers, 'Must have "mcpServers" root key');
        const server = config.mcpServers['index-server'];
        assert(server, 'Must have "index-server" entry');
        assert(server.command === 'node', 'command must be "node"');
        assert(Array.isArray(server.args), 'args must be array');
        assert(
          path.isAbsolute(server.args[0]),
          `args[0] must be absolute path, got: ${server.args[0]}`,
        );
        assert(
          fwd(server.args[0]).includes('dist/server/index-server.js'),
          `args must reference index-server.js, got: ${server.args[0]}`,
        );
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Test suite 2: Multi-target combined generation
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n\n═══ Multi-Target Combined ═══\n');
{
  const testDir = path.join(tmpBase, 'multi-target');
  const fakeHome = path.join(tmpBase, 'home-multi');
  fs.mkdirSync(testDir, { recursive: true });
  fs.mkdirSync(fakeHome, { recursive: true });

  try {
    runWizard(
      ['--target', 'vscode,copilot-cli,claude', '--root', testDir, '--write', '--no-deploy'],
      { HOME: fakeHome, USERPROFILE: fakeHome },
    );

    runTest('vscode mcp.json generated', () => {
      assert(
        fs.existsSync(path.join(testDir, '.vscode', 'mcp.json')),
        '.vscode/mcp.json must exist',
      );
    });

    runTest('copilot-cli mcp-config.json generated', () => {
      assert(
        fs.existsSync(copilotConfigPath(fakeHome)),
        'mcp-config.json must exist',
      );
    });

    runTest('claude config generated', () => {
      assert(
        fs.existsSync(claudeConfigPath(fakeHome)),
        'claude_desktop_config.json must exist',
      );
    });
  } catch (err) {
    console.error(`  ❌ Multi-target wizard failed: ${err.message}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Test suite 3: Merge & backup behavior (copilot-cli)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n\n═══ Merge & Backup Behavior ═══\n');
{
  const fakeHome = path.join(tmpBase, 'home-merge');
  const copilotDir = path.join(fakeHome, '.copilot');
  fs.mkdirSync(copilotDir, { recursive: true });

  // Pre-populate with an existing server entry
  const existing = {
    mcpServers: {
      'other-server': { command: 'node', args: ['other.js'], env: { FOO: 'bar' } },
    },
  };
  const configFile = path.join(copilotDir, 'mcp-config.json');
  fs.writeFileSync(configFile, JSON.stringify(existing, null, 2));

  try {
    execFileSync(
      process.execPath,
      [WIZARD, '--non-interactive', '--no-preview', '--target', 'copilot-cli', '--write', '--no-deploy'],
      {
        cwd: ROOT,
        stdio: 'pipe',
        timeout: 30_000,
        env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
      },
    );

    runTest('pre-existing server preserved after merge', () => {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      assert(config.mcpServers['other-server'], 'Pre-existing "other-server" must survive merge');
      assert(
        config.mcpServers['other-server'].env?.FOO === 'bar',
        'Pre-existing server env must be intact',
      );
    });

    runTest('new server added by merge', () => {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      assert(
        config.mcpServers['index-server'],
        '"index-server" must be present after merge',
      );
    });

    runTest('backup file created before merge', () => {
      const files = fs.readdirSync(copilotDir);
      const backups = files.filter(f => f.includes('.backup.'));
      assert(backups.length > 0, 'A backup file must be created before overwriting');
    });
  } catch (err) {
    console.error(`  ❌ Merge test failed: ${err.message}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Test suite 4: VS Code global scope (sidecar generation)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n\n═══ VS Code Global Scope ═══\n');
{
  const fakeHome = path.join(tmpBase, 'home-vscode-global');
  fs.mkdirSync(fakeHome, { recursive: true });

  try {
    const output = runWizard(
      ['--target', 'vscode', '--scope', 'global', '--write', '--no-deploy'],
      { HOME: fakeHome, USERPROFILE: fakeHome },
    );

    runTest('global scope produces sidecar or generated file', () => {
      // Global scope should either write mcp.json.generated (sidecar) or
      // write to the user settings directory. Either way, something must be produced.
      assert(
        output.includes('Generated') || output.includes('Written') || output.includes('generated'),
        'Output should mention generated or written file',
      );
    });
  } catch (err) {
    console.error(`  ❌ Global scope test failed: ${err.message}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n\n═══ Config Validation Summary: ${passed} passed, ${failed} failed ═══\n`);

// Cleanup
try {
  fs.rmSync(tmpBase, { recursive: true, force: true });
} catch {
  /* ok */
}

process.exit(failed > 0 ? 1 : 0);
