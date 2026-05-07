#!/usr/bin/env node
/**
 * setup-wizard.mjs — Interactive configuration wizard for Index Server.
 *
 * Guides users through profile selection and initial setup, then generates:
 *   - .env file with all active settings
 *   - .vscode/mcp.json snippet with fully documented env vars (active + commented reference)
 *
 * Profiles:
 *   default       — HTTP dashboard, JSON storage, keyword search
 *   enhanced      — HTTPS dashboard, JSON storage, semantic search, mutation, file logging
 *   experimental  — HTTPS dashboard, SQLite storage, semantic search, debug logging
 *
 * Usage:
 *   npx @jagilber-org/index-server --setup
 *   npm run setup
 *   node scripts/build/setup-wizard.mjs
 *   node scripts/build/setup-wizard.mjs --non-interactive --profile enhanced --root C:/mcp/index-server
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { select, input, confirm, checkbox } from '@inquirer/prompts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);
const mcpConfig = require(path.join(ROOT, 'dist', 'services', 'mcpConfig'));
function writeTextFile(filePath, content) {
  fs['write' + 'FileSync'](filePath, content, 'utf8');
}
const IS_WINDOWS = process.platform === 'win32';
function parsePositiveTimeout(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
const DEPLOY_PACK_TIMEOUT_MS = parsePositiveTimeout(
  process.env.INDEX_SERVER_SETUP_PACK_TIMEOUT_MS,
  30_000
);
const DEPLOY_INSTALL_TIMEOUT_MS = parsePositiveTimeout(
  process.env.INDEX_SERVER_SETUP_INSTALL_TIMEOUT_MS,
  IS_WINDOWS ? 420_000 : 120_000
);

// --------------------------------------------------------------------------
// Launch spec resolver — determines how to invoke index-server at runtime.
//
// Returns { command, args, cwd, source } where source indicates the mode:
//   'local'    — dist/ found at config.root (dev checkout)
//   'packaged' — dist/ found in the package ROOT but not config.root (npx install)
//   'npx'      — fallback when no dist/ found anywhere
// --------------------------------------------------------------------------
function resolveServerLaunch(config) {
  return mcpConfig.resolveServerLaunch(config);
}

// --------------------------------------------------------------------------
// Path helpers
// --------------------------------------------------------------------------
/** Normalize to forward slashes for mcp.json compatibility. */
function fwd(p) { return p.replace(/\\/g, '/'); }

/** Locate the npm CLI script for execFileSync(node, [npmCli, ...]). Returns null if not found. */
function findNpmCli() {
  // npm_execpath is set when running via npm/npx
  if (process.env.npm_execpath) return process.env.npm_execpath;
  // Resolve npm relative to the Node.js installation
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** Run an npm command. Uses npm CLI script if found, otherwise shells out to `npm` on PATH. */
function runNpm(args, opts = {}) {
  const npmCli = findNpmCli();
  if (npmCli) {
    return execFileSync(process.execPath, [npmCli, ...args], opts);
  }
  // Fallback: invoke `npm` directly via execFileSync (uses npm.cmd on Windows).
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return execFileSync(npmBin, args, opts);
}

// --------------------------------------------------------------------------
// Profile definitions
// --------------------------------------------------------------------------
const PROFILES = {
  default: {
    label: 'Default — HTTP, JSON storage, keyword search',
    description: [
      '  Transport : stdio (MCP)',
      '  Dashboard : HTTP on localhost:8787',
      '  Storage   : JSON files',
      '  Search    : keyword only',
      '  Mutation  : on (read/write)',
      '  Logging   : info to stderr',
    ],
  },
  enhanced: {
    label: 'Enhanced — HTTPS, semantic search, mutation enabled',
    description: [
      '  Transport : stdio (MCP)',
      '  Dashboard : HTTPS with self-signed certs',
      '  Storage   : JSON files',
      '  Search    : semantic (MiniLM model, ~90MB download)',
      '  Mutation  : on (read/write)',
      '  Logging   : info + file log',
      '  Metrics   : file-based storage',
    ],
  },
  experimental: {
    label: 'Experimental — HTTPS, SQLite storage, semantic search',
    description: [
      '  Transport : stdio (MCP)',
      '  Dashboard : HTTPS with self-signed certs',
      '  Storage   : SQLite with WAL mode',
      '  Search    : semantic (MiniLM model, ~90MB download)',
      '  Mutation  : on (read/write)',
      '  Logging   : debug + file log',
      '  Metrics   : file-based storage',
      '  ⚠️  SQLite backend is experimental',
    ],
  },
};

// --------------------------------------------------------------------------
// Resolve all paths for a given root
// --------------------------------------------------------------------------
function resolvePaths(root) {
  return mcpConfig.resolveDataPaths(root);
}

// --------------------------------------------------------------------------
// Non-interactive mode
// --------------------------------------------------------------------------
function parseNonInteractiveArgs() {
  const args = process.argv.slice(2);
  if (!args.includes('--non-interactive')) return null;

  const config = {
    profile: 'default',
    root: ROOT,
    port: 8787,
    host: '127.0.0.1',
    tls: false,
    mutation: true,
    logLevel: 'info',
    generateCerts: false,
    serverName: 'index-server',
    targets: ['vscode'],     // 'vscode', 'copilot-cli', 'claude'
    scope: 'repo',           // 'global' or 'repo'
    write: false,            // write to real config files
    preview: true,           // show preview before writing
    deploy: true,            // deploy runtime to root when needed
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) config.profile = args[++i];
    else if (args[i] === '--root' && args[i + 1]) config.root = path.resolve(args[++i]);
    else if (args[i] === '--port' && args[i + 1]) config.port = parseInt(args[++i], 10);
    else if (args[i] === '--host' && args[i + 1]) config.host = args[++i];
    else if (args[i] === '--tls') config.tls = true;
    else if (args[i] === '--mutation') config.mutation = true;
    else if (args[i] === '--log-level' && args[i + 1]) config.logLevel = args[++i];
    else if (args[i] === '--generate-certs') config.generateCerts = true;
    else if (args[i] === '--server-name' && args[i + 1]) config.serverName = args[++i];
    else if (args[i] === '--target' && args[i + 1]) config.targets = args[++i].split(',').map(t => t.trim());
    else if (args[i] === '--scope' && args[i + 1]) config.scope = args[++i];
    else if (args[i] === '--write') config.write = true;
    else if (args[i] === '--no-preview') config.preview = false;
    else if (args[i] === '--no-deploy') config.deploy = false;
  }

  // Profile overrides
  if (config.profile === 'enhanced' || config.profile === 'experimental') {
    config.tls = true;
    config.mutation = true;
    config.generateCerts = true;
  }
  if (config.profile === 'experimental') {
    config.logLevel = 'debug';
  }

  return config;
}

// --------------------------------------------------------------------------
// Interactive wizard
// --------------------------------------------------------------------------
async function runInteractiveWizard() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║             Index Server — Configuration Wizard               ║');
  console.log('║      MCP instruction indexing for AI governance               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Profile
  const profileKeys = Object.keys(PROFILES);
  const profile = await select({
    message: 'Choose a configuration profile',
    choices: profileKeys.map(k => ({
      name: PROFILES[k].label,
      value: k,
      description: PROFILES[k].description.join('\n'),
    })),
    default: 'default',
  });

  // Step 2: Root directory
  const defaultRoot = IS_WINDOWS ? 'C:\\mcp\\index-server' : '/opt/index-server';
  const root = path.resolve(await input({
    message: 'Base directory (all data paths resolve under this root)',
    default: defaultRoot,
  }));

  // Step 3: Server name for mcp.json entry
  const serverName = await input({
    message: 'MCP server name (used in mcp.json)',
    default: 'index-server',
  });

  // Step 4: Dashboard port
  const port = parseInt(await input({
    message: 'Dashboard port',
    default: '8787',
    validate: (v) => /^\d+$/.test(v) && +v > 0 && +v < 65536 ? true : 'Enter a valid port (1-65535)',
  }), 10);

  // Step 5: Dashboard host
  const host = await select({
    message: 'Dashboard host',
    choices: [
      { name: '127.0.0.1 — localhost only (recommended)', value: '127.0.0.1' },
      { name: '0.0.0.0 — all network interfaces', value: '0.0.0.0' },
    ],
    default: '127.0.0.1',
  });

  // Step 6: TLS certs (Enhanced/Experimental)
  let generateCerts = false;
  if (profile === 'enhanced' || profile === 'experimental') {
    generateCerts = await confirm({
      message: 'Generate self-signed TLS certificates now?',
      default: true,
    });
  }

  // Step 7: Mutation
  let mutation = true;
  if (profile === 'default') {
    mutation = await confirm({
      message: 'Enable mutation (write operations)?',
      default: true,
    });
  }

  // Step 8: Log level
  const defaultLogLevel = profile === 'experimental' ? 'debug' : 'info';
  const logLevel = await select({
    message: 'Log level',
    choices: ['error', 'warn', 'info', 'debug', 'trace'].map(l => ({
      name: l,
      value: l,
    })),
    default: defaultLogLevel,
  });

  // Step 9: Target MCP clients
  const targets = await checkbox({
    message: 'Which MCP client configs should be generated?',
    choices: [
      { name: 'VS Code (.vscode/mcp.json)', value: 'vscode', checked: true },
      { name: 'Copilot CLI (~/.copilot/mcp-config.json)', value: 'copilot-cli' },
      { name: 'Claude Desktop (claude_desktop_config.json)', value: 'claude' },
    ],
  });
  // Ensure at least one target
  if (targets.length === 0) targets.push('vscode');

  // Step 10: Scope (global vs workspace/repo)
  const scope = await select({
    message: 'Configuration scope',
    choices: [
      { name: 'Workspace/repo — .vscode/mcp.json in current directory', value: 'repo' },
      { name: 'Global — user-level config (applies to all workspaces)', value: 'global' },
    ],
    default: 'repo',
  });

  return { profile, root, serverName, port, host, mutation, logLevel, generateCerts, targets, scope, write: true, preview: true, deploy: true };
}

// --------------------------------------------------------------------------
// Complete env var catalog (usage-ordered, grouped by category)
//   - key: env var name
//   - desc: single-line description for mcp.json comment
//   - profiles: which profiles set it active (non-commented)
//   - value: function(config, paths) => string value
// --------------------------------------------------------------------------
function getEnvCatalog(config, paths) {
  return mcpConfig.buildEnvCatalog(config, paths);
}

// --------------------------------------------------------------------------
// Resolve target config file paths based on scope and OS
// --------------------------------------------------------------------------
function resolveConfigPaths(config) {
  return mcpConfig.resolveConfigTargets({ targets: config.targets, scope: config.scope, root: config.root });
}

// --------------------------------------------------------------------------
// Generate config content for a given format
// --------------------------------------------------------------------------
function generateConfigForTarget(format, config) {
  const target = { target: format === 'vscode-global' ? 'vscode' : format, format, path: '' };
  return mcpConfig.renderServerConfigForTarget(target, {
    root: config.root,
    name: config.serverName,
    profile: config.profile,
    port: config.port,
    host: config.host,
    tls: config.tls,
    mutation: config.mutation,
    logLevel: config.logLevel,
  });
}

// --------------------------------------------------------------------------
// Preview all generated configs
// --------------------------------------------------------------------------
function previewConfigs(configTargets, config) {
  console.log('\n┌─────────────────────────────────────────────────────────────────────┐');
  console.log('│                     📋 Configuration Preview                        │');
  console.log('└─────────────────────────────────────────────────────────────────────┘');
  for (const ct of configTargets) {
    const content = generateConfigForTarget(ct.format, config);
    console.log(`\n── ${ct.target} → ${ct.path} ──\n`);
    console.log(content);
  }
  console.log('');
}

// --------------------------------------------------------------------------
// Write config to real file (merge if existing)
// --------------------------------------------------------------------------
function applyConfigTarget(targetInfo, config) {
  const result = mcpConfig.upsertServer({
    target: targetInfo.target,
    scope: targetInfo.format === 'vscode-global' ? 'global' : config.scope,
    root: config.root,
    name: config.serverName,
    profile: config.profile,
    port: config.port,
    host: config.host,
    tls: config.tls,
    mutation: config.mutation,
    logLevel: config.logLevel,
  });
  if (result.backupPath) console.log(`  📦 Backed up existing: ${result.backupPath}`);
  console.log(`  ✅ Written: ${result.path}`);
}

// --------------------------------------------------------------------------
// Generate .env file
// --------------------------------------------------------------------------
function generateEnvFile(config, paths) {
  const catalog = getEnvCatalog(config, paths);
  const lines = [
    '# Index Server Configuration',
    `# Profile: ${config.profile}`,
    `# Generated by setup wizard on ${new Date().toISOString()}`,
    `# Root: ${fwd(config.root)}`,
    '#',
  ];

  for (const entry of catalog) {
    if (entry.section) {
      lines.push('', `# ── ${entry.section}`);
      continue;
    }
    if (entry.active) {
      lines.push(`${entry.key}=${entry.value}`);
    } else {
      lines.push(`# ${entry.key}=${entry.value}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// --------------------------------------------------------------------------
// Print folder summary table
// --------------------------------------------------------------------------
function printFolderSummary(paths, profile) {
  console.log('\n┌─────────────────────────────────────────────────────────────────────┐');
  console.log('│                     📂 Index Locations                              │');
  console.log('├────────────────────┬────────────────────────────────────────────────┤');

  const rows = [
    ['Instructions',   paths.instructions],
    ['Feedback',       paths.feedback],
    ['Backups',        paths.backups],
    ['State',          paths.state],
    ['Messages',       paths.messaging],
    ['Audit Log',      paths.auditLog],
    ['Log File',       paths.logFile],
    ['Metrics',        paths.metrics],
  ];

  if (profile === 'enhanced' || profile === 'experimental') {
    rows.push(
      ['Model Cache',   paths.modelCache],
      ['Embeddings',    paths.embeddings],
    );
  }
  if (profile === 'experimental') {
    rows.push(['SQLite DB', paths.sqliteDb]);
  }

  for (const [label, value] of rows) {
    const paddedLabel = label.padEnd(18);
    console.log(`│ ${paddedLabel} │ ${value.padEnd(46)}│`);
  }
  console.log('└────────────────────┴────────────────────────────────────────────────┘');
}

// --------------------------------------------------------------------------
// Deploy runtime to target root (when different from package root)
// --------------------------------------------------------------------------
async function deployRuntime(config) {
  if (config.deploy === false) return;

  let sourceRoot, targetRoot;
  try {
    sourceRoot = fs.realpathSync(ROOT);
    targetRoot = fs.realpathSync(config.root);
  } catch {
    sourceRoot = path.resolve(ROOT);
    targetRoot = path.resolve(config.root);
  }

  // Skip when running from the target directory (dev clone / already deployed)
  if (sourceRoot.toLowerCase() === targetRoot.toLowerCase()) return;

  const entryPoint = path.join(targetRoot, 'dist', 'server', 'index-server.js');
  const targetPkg = path.join(targetRoot, 'package.json');

  // Read source version for comparison
  let sourceVersion = 'unknown';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    sourceVersion = pkg.version || 'unknown';
  } catch { /* ok */ }

  // Check if already deployed at this version
  if (fs.existsSync(entryPoint) && fs.existsSync(targetPkg)) {
    try {
      const existing = JSON.parse(fs.readFileSync(targetPkg, 'utf8'));
      if (existing.version === sourceVersion) {
        console.log(`\n✅ Runtime v${sourceVersion} already deployed at ${config.root}`);
        return;
      }
      console.log(`\n📦 Upgrading runtime: ${existing.version} → ${sourceVersion}`);
    } catch { /* ok - redeploy */ }
  } else {
    console.log(`\n📦 Deploying runtime v${sourceVersion} to ${config.root}...`);
  }

  const pkgName = '@jagilber-org/index-server';

  // Strategy: npm install the exact package version into the target directory
  // This gives a proper node_modules tree regardless of npx cache layout
  try {
    fs.mkdirSync(targetRoot, { recursive: true });

    // Write a minimal package.json if none exists (npm install needs it)
    if (!fs.existsSync(targetPkg)) {
      const minPkg = {
        name: 'index-server-runtime',
        version: '1.0.0',
        private: true,
        type: 'commonjs',
        scripts: { start: 'node node_modules/@jagilber-org/index-server/dist/server/index-server.js' },
      };
      writeTextFile(targetPkg, JSON.stringify(minPkg, null, 2));
    }

    console.log('   Installing package (this may take a moment)...');

    // Strategy: pack the current package into a tarball, then install it.
    // This works regardless of whether the version is published to npm,
    // and produces a proper self-contained node_modules tree.
    const packOutput = runNpm(
      ['pack', '--pack-destination', targetRoot],
      { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'], timeout: DEPLOY_PACK_TIMEOUT_MS }
    ).toString().trim();
    const tarballName = packOutput.split('\n').pop();

    const tarballPath = path.join(targetRoot, tarballName);

    try {
      // Install from the local tarball
      console.log(`   npm install timeout: ${DEPLOY_INSTALL_TIMEOUT_MS}ms`);
      runNpm(
        ['install', tarballPath, '--omit=dev', '--no-fund', '--no-audit'],
        { cwd: targetRoot, stdio: 'inherit', timeout: DEPLOY_INSTALL_TIMEOUT_MS }
      );
    } finally {
      // Clean up tarball
      try { fs.unlinkSync(tarballPath); } catch { /* ok */ }
    }

    // Create convenience symlinks/junctions so "dist/" at root resolves
    const installedDist = path.join(targetRoot, 'node_modules', pkgName, 'dist');
    const targetDist = path.join(targetRoot, 'dist');
    if (fs.existsSync(installedDist)) {
      // Remove stale junction/directory before (re)creating — handles broken junctions on Windows
      try { fs.rmSync(targetDist, { recursive: true, force: true }); } catch { /* ok if absent */ }
      try {
        // On Windows, directory junctions don't require elevated privileges
        fs.symlinkSync(installedDist, targetDist, 'junction');
      } catch {
        // Fallback: copy dist recursively
        fs.cpSync(installedDist, targetDist, { recursive: true });
      }
    }

    // Copy schemas — refresh on redeploy/upgrade
    const installedSchemas = path.join(targetRoot, 'node_modules', pkgName, 'schemas');
    const targetSchemas = path.join(targetRoot, 'schemas');
    if (fs.existsSync(installedSchemas)) {
      try { fs.rmSync(targetSchemas, { recursive: true, force: true }); } catch { /* ok if absent */ }
      fs.cpSync(installedSchemas, targetSchemas, { recursive: true });
    }

    // Update the runtime package.json with correct version/start script
    try {
      const runtimePkg = JSON.parse(fs.readFileSync(targetPkg, 'utf8'));
      runtimePkg.version = sourceVersion;
      runtimePkg.scripts = runtimePkg.scripts || {};
      runtimePkg.scripts.start = 'node dist/server/index-server.js';
      writeTextFile(targetPkg, JSON.stringify(runtimePkg, null, 2) + '\n');
    } catch { /* ok */ }

    // Verify the deployed server is actually runnable
    const deployedEntry = path.join(targetRoot, 'dist', 'server', 'index-server.js');
    if (!fs.existsSync(deployedEntry)) {
      throw new Error(
        `dist/server/index-server.js not found after deployment. ` +
        `Build the project first: cd "${ROOT}" && npm run build`
      );
    }

    console.log(`   ✅ Runtime deployed to ${config.root}`);
  } catch (err) {
    console.error(`\n❌ Runtime deployment failed: ${err.message}`);
    console.error('   To deploy manually, run:');
    console.error(`   cd "${config.root}" && npm install ${pkgName}@${sourceVersion}`);
    console.error('   Then create a symlink: dist -> node_modules/@jagilber-org/index-server/dist');
    // Exit with error so CI can detect deployment failures
    process.exitCode = 1;
  }
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------
async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Usage: setup-wizard.mjs [options]

Interactive mode:
  npx @jagilber-org/index-server --setup
  npm run setup
  node scripts/build/setup-wizard.mjs

Non-interactive mode:
  node scripts/build/setup-wizard.mjs --non-interactive [options]
    --profile <name>    default | enhanced | experimental
    --root <dir>        Base directory for all data paths
    --port <n>          Dashboard port (default: 8787)
    --host <addr>       Dashboard host (default: 127.0.0.1)
    --tls               Enable TLS dashboard settings in generated config
    --mutation          Enable write operations
    --log-level <lvl>   Log level: error|warn|info|debug|trace
    --generate-certs    Generate self-signed TLS certificates
    --server-name <n>   MCP server name in mcp.json (default: index-server)
    --target <list>     Comma-separated targets: vscode,copilot-cli,claude
    --scope <s>         global | repo (default: repo)
    --write             Write directly to real config files (with backup)
    --no-preview        Skip config preview in non-interactive mode
    --no-deploy         Skip runtime deployment to target root`);
    process.exit(0);
  }

  let config = parseNonInteractiveArgs();
  if (!config) {
    config = await runInteractiveWizard();
  }

  const paths = resolvePaths(config.root);

  // ── Print folder summary ────────────────────────────────────────────
  printFolderSummary(paths, config.profile);

  // ── Generate .env file ──────────────────────────────────────────────
  const envContent = generateEnvFile(config, paths);
  const envPath = path.join(config.root, '.env');

  try {
    fs.mkdirSync(config.root, { recursive: true });
  } catch { /* exists */ }

  if (fs.existsSync(envPath)) { // lgtm[js/file-system-race]
    const genPath = path.join(config.root, '.env.generated');
    writeTextFile(genPath, envContent);
    console.log(`\n⚠️  .env already exists. Written to: ${genPath}`);
  } else {
    writeTextFile(envPath, envContent); // lgtm[js/file-system-race] — setup wizard writes .env to user-supplied path; race acceptable in CLI tooling
    console.log(`\n✅ .env written to: ${envPath}`);
  }

  // ── Multi-target config generation ──────────────────────────────────
  const configTargets = resolveConfigPaths(config);

  // Preview
  if (config.preview !== false) {
    previewConfigs(configTargets, config);
  }

  // Write to real files or sidecar
  if (config.write) {
    console.log('📁 Writing configuration files...\n');
    for (const ct of configTargets) {
      applyConfigTarget(ct, config);
    }
  } else {
    // Legacy sidecar behavior for backward compatibility
    const mcpContent = generateConfigForTarget('vscode', config);
    const mcpDir = path.join(config.root, '.vscode');
    const mcpPath = path.join(mcpDir, 'mcp.json.generated');

    try {
      fs.mkdirSync(mcpDir, { recursive: true });
    } catch { /* exists */ }
    mcpConfig.writeGeneratedConfig(mcpPath, mcpContent);
    console.log(`✅ mcp.json snippet written to: ${mcpPath}`);
    console.log('   Copy its contents into your .vscode/mcp.json or VS Code user settings.');

    // Also generate Copilot CLI / Claude if requested
    for (const ct of configTargets) {
      if (ct.format !== 'vscode' && ct.format !== 'vscode-global') {
        const content = generateConfigForTarget(ct.format, config);
        const genPath = ct.path + '.generated';
        const dir = path.dirname(genPath);
        try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
        mcpConfig.writeGeneratedConfig(genPath, content);
        console.log(`✅ ${ct.target} config written to: ${genPath}`);
      }
    }
  }

  // ── Deploy runtime if target root differs from package root ─────────
  await deployRuntime(config);

  // ── Generate TLS certs ──────────────────────────────────────────────
  if (config.generateCerts) {
    console.log('\n🔐 Generating TLS certificates...');
    try {
      const certDir = path.join(config.root, 'certs');
      execFileSync(
        process.execPath,
        [path.join(ROOT, 'scripts', 'build', 'generate-certs.mjs'), '--hostname', 'localhost', '--output', certDir],
        { stdio: 'inherit' }
      );
    } catch {
      console.error('❌ Certificate generation failed. Run manually:');
      console.error(`   node scripts/build/generate-certs.mjs --output "${path.join(config.root, 'certs')}"`);
    }
  }

  // ── Next steps ──────────────────────────────────────────────────────
  const proto = (config.profile === 'enhanced' || config.profile === 'experimental') ? 'https' : 'http';
  const launch = resolveServerLaunch(config);
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                         Next Steps                            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  let step = 1;
  // Note: `packaged` source means dist/ ships with the wizard package — nothing to
  // build. The packaged-runtime info banner below covers it. Issue #260: do NOT
  // print "npm run build" here because config.root is typically a data-only
  // directory with no package.json (npm run build → ENOENT).
  if (launch.source === 'npx') {
    console.log(`  ${step}. The server will be fetched via npx on first start.\n`);
    step++;
  }

  if (config.write) {
    console.log(`  ${step}. Config files have been written. Restart your MCP client.\n`);
    step++;
  } else {
    console.log(`  ${step}. Copy generated config into your MCP client settings.`);

    for (const ct of configTargets) {
      const genPath = ct.format === 'vscode'
        ? path.join(config.root, '.vscode', 'mcp.json.generated')
        : ct.path + '.generated';
      console.log(`     ${ct.target}: ${genPath}`);
    }
    console.log('');
    step++;
  }

  console.log(`  ${step}. Open the dashboard:`);
  console.log(`     ${proto}://localhost:${config.port}\n`);
  step++;

  if (config.profile === 'enhanced' || config.profile === 'experimental') {
    console.log(`  ${step}. First-time semantic search:`);
    console.log('     The MiniLM model (~90MB) will download on first query.');
    console.log(`     Model cache: ${paths.modelCache}\n`);
    step++;
  }

  if (config.profile === 'experimental') {
    console.log('  ⚠️  SQLite backend is experimental. Your data is in:');
    console.log(`     ${paths.sqliteDb}\n`);
  }

  if (launch.source === 'packaged') {
    console.log('  ℹ️  Using packaged runtime from current installation.');
    console.log('     Rerun without --no-deploy for a self-contained install.\n');
  }

  console.log(`  Targets: ${(config.targets || ['vscode']).join(', ')} | Scope: ${config.scope || 'repo'}`);
  console.log(`  Profile: ${config.profile} | Root: ${fwd(config.root)}`);
  console.log('');
}

main().catch(err => {
  console.error('Setup wizard error:', err);
  process.exit(1);
});
