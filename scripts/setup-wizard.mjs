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
 *   node scripts/setup-wizard.mjs
 *   node scripts/setup-wizard.mjs --non-interactive --profile enhanced --root C:/mcp/index-server
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { select, input, confirm, checkbox } from '@inquirer/prompts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IS_WINDOWS = process.platform === 'win32';

// --------------------------------------------------------------------------
// Launch spec resolver — determines how to invoke index-server at runtime.
//
// Returns { command, args, cwd, source } where source indicates the mode:
//   'local'    — dist/ found at config.root (dev checkout)
//   'packaged' — dist/ found in the package ROOT but not config.root (npx install)
//   'npx'      — fallback when no dist/ found anywhere
// --------------------------------------------------------------------------
function resolveServerLaunch(config) {
  const entryRelative = 'dist/server/index-server.js';
  const localEntry = path.join(config.root, entryRelative);
  const packagedEntry = path.join(ROOT, entryRelative);

  // Case 1: config.root is the repo checkout with dist/ present
  if (fs.existsSync(localEntry)) {
    return {
      command: 'node',
      args: [entryRelative],
      cwd: config.root,
      source: 'local',
    };
  }

  // Case 2: dist/ exists in the package root (npx cache) but not in config.root
  if (fs.existsSync(packagedEntry)) {
    return {
      command: 'node',
      args: [fwd(packagedEntry)],
      cwd: config.root,
      source: 'packaged',
    };
  }

  // Case 3: no dist/ anywhere — use npx as last resort
  let pkgName = '@jagilber-org/index-server';
  let pkgVersion = '';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    if (pkg.name) pkgName = pkg.name;
    if (pkg.version) pkgVersion = `@${pkg.version}`;
  } catch {
    console.warn('⚠ Could not read package.json — npx will use latest published version');
  }

  return {
    command: 'npx',
    args: ['-y', `${pkgName}${pkgVersion}`],
    cwd: config.root,
    source: 'npx',
  };
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

/** Resolve a sub-path under a root, always absolute and forward-slashed. */
function resolveUnder(root, ...segments) { return fwd(path.resolve(root, ...segments)); }

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
  return {
    instructions:  resolveUnder(root, 'instructions'),
    feedback:      resolveUnder(root, 'feedback'),
    backups:       resolveUnder(root, 'backups'),
    state:         resolveUnder(root, 'data', 'state'),
    auditLog:      resolveUnder(root, 'logs', 'instruction-transactions.log.jsonl'),
    logFile:       resolveUnder(root, 'logs', 'mcp-server.log'),
    metrics:       resolveUnder(root, 'metrics'),
    messaging:     resolveUnder(root, 'data', 'messaging'),
    embeddings:    resolveUnder(root, 'data', 'embeddings.json'),
    modelCache:    resolveUnder(root, 'data', 'models'),
    sqliteDb:      resolveUnder(root, 'data', 'index.db'),
    certs:         resolveUnder(root, 'certs'),
    flags:         resolveUnder(root, 'flags.json'),
  };
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
  const p = config.profile;
  const isEnhanced = p === 'enhanced' || p === 'experimental';
  const isSqlite = p === 'experimental';
  const tls = config.tls;

  return [
    // ── Core Paths ─────────────────────────────────────────────────────────
    { section: 'Core Paths — where your data lives' },
    { key: 'INDEX_SERVER_PROFILE',      desc: 'Configuration profile: default | enhanced | experimental', active: true, value: p },
    { key: 'INDEX_SERVER_DIR',          desc: 'Instruction catalog directory (your knowledge base)', active: true, value: paths.instructions },
    { key: 'INDEX_SERVER_FEEDBACK_DIR', desc: 'Feedback entries storage directory', active: true, value: paths.feedback },
    { key: 'INDEX_SERVER_BACKUPS_DIR',  desc: 'Backup snapshots directory', active: true, value: paths.backups },
    { key: 'INDEX_SERVER_STATE_DIR',    desc: 'Runtime state files directory', active: true, value: paths.state },
    { key: 'INDEX_SERVER_MESSAGING_DIR',desc: 'Message queue storage directory', active: true, value: paths.messaging },

    // ── Dashboard (HTTP Admin UI) ──────────────────────────────────────────
    { section: 'Dashboard — HTTP/HTTPS admin interface' },
    { key: 'INDEX_SERVER_DASHBOARD',       desc: 'Enable the web dashboard (0=off, 1=on)', active: true, value: '1' },
    { key: 'INDEX_SERVER_DASHBOARD_PORT',  desc: 'Dashboard listen port', active: true, value: String(config.port) },
    { key: 'INDEX_SERVER_DASHBOARD_HOST',  desc: 'Dashboard bind address (127.0.0.1=local, 0.0.0.0=all)', active: true, value: config.host },
    { key: 'INDEX_SERVER_DASHBOARD_GRAPH', desc: 'Enable instruction graph visualization (0=off, 1=on)', active: false, value: '0' },

    // ── Security & Mutation ────────────────────────────────────────────────
    { section: 'Security — mutation control, TLS, authentication' },
    { key: 'INDEX_SERVER_MUTATION',            desc: 'Enable write operations: add, update, delete (0=off, 1=on)', active: true, value: config.mutation ? '1' : '0' },
    { key: 'INDEX_SERVER_ADMIN_API_KEY',       desc: 'Dashboard admin API key (set a strong random value)', active: false, value: '' },
    { key: 'INDEX_SERVER_DASHBOARD_TLS',       desc: 'Enable HTTPS for dashboard (0=off, 1=on)', active: tls, value: tls ? '1' : '0' },
    { key: 'INDEX_SERVER_DASHBOARD_TLS_CERT',  desc: 'Path to TLS certificate file (.crt/.pem)', active: tls, value: tls ? resolveUnder(paths.certs, 'server.crt') : '' },
    { key: 'INDEX_SERVER_DASHBOARD_TLS_KEY',   desc: 'Path to TLS private key file (.key/.pem)', active: tls, value: tls ? resolveUnder(paths.certs, 'server.key') : '' },
    { key: 'INDEX_SERVER_DASHBOARD_TLS_CA',    desc: 'Path to CA certificate for client verification (optional)', active: false, value: '' },

    // ── Semantic Search & Embeddings ───────────────────────────────────────
    { section: 'Semantic Search — AI-powered instruction search' },
    { key: 'INDEX_SERVER_SEMANTIC_ENABLED',    desc: 'Enable semantic (vector) search (0=off, 1=on)', active: isEnhanced, value: isEnhanced ? '1' : '0' },
    { key: 'INDEX_SERVER_SEMANTIC_MODEL',      desc: 'HuggingFace model name for embeddings', active: false, value: 'Xenova/all-MiniLM-L6-v2' },
    { key: 'INDEX_SERVER_SEMANTIC_DEVICE',     desc: 'Compute device: cpu | cuda | dml (Windows ML)', active: false, value: 'cpu' },
    { key: 'INDEX_SERVER_SEMANTIC_CACHE_DIR',  desc: 'Directory for downloaded model files (~90MB)', active: isEnhanced, value: paths.modelCache },
    { key: 'INDEX_SERVER_EMBEDDING_PATH',      desc: 'Cached embeddings file (grows with catalog size)', active: isEnhanced, value: paths.embeddings },
    { key: 'INDEX_SERVER_SEMANTIC_LOCAL_ONLY', desc: 'Block remote model downloads (0=allow download, 1=local only)', active: isEnhanced, value: isEnhanced ? '0' : '1' },

    // ── Storage Backend ────────────────────────────────────────────────────
    { section: 'Storage Backend — JSON (default) or SQLite (experimental)' },
    { key: 'INDEX_SERVER_STORAGE_BACKEND',       desc: 'Storage engine: json | sqlite', active: isSqlite, value: isSqlite ? 'sqlite' : 'json' },
    { key: 'INDEX_SERVER_SQLITE_PATH',           desc: 'SQLite database file path', active: isSqlite, value: paths.sqliteDb },
    { key: 'INDEX_SERVER_SQLITE_WAL',            desc: 'Enable Write-Ahead Logging for SQLite (0=off, 1=on)', active: isSqlite, value: '1' },
    { key: 'INDEX_SERVER_SQLITE_MIGRATE_ON_START', desc: 'Auto-migrate JSON to SQLite on startup (0=off, 1=on)', active: isSqlite, value: '1' },

    // ── Logging & Diagnostics ──────────────────────────────────────────────
    { section: 'Logging — log level, file output, diagnostics' },
    { key: 'INDEX_SERVER_LOG_LEVEL',       desc: 'Log level: error | warn | info | debug | trace', active: true, value: config.logLevel },
    { key: 'INDEX_SERVER_LOG_FILE',        desc: 'Enable file logging (0=off, 1=default path, or absolute path)', active: isEnhanced, value: isEnhanced ? '1' : '0' },
    { key: 'INDEX_SERVER_VERBOSE_LOGGING', desc: 'Verbose stderr output (0=off, 1=on)', active: false, value: '0' },
    { key: 'INDEX_SERVER_LOG_JSON',        desc: 'JSON-formatted log output (0=off, 1=on)', active: false, value: '0' },
    { key: 'INDEX_SERVER_LOG_DIAG',        desc: 'Diagnostic startup logging (0=off, 1=on)', active: false, value: '0' },
    { key: 'INDEX_SERVER_AUDIT_LOG',       desc: 'Audit log path (1=default, 0=disabled, or absolute path)', active: true, value: paths.auditLog },

    // ── Backup & Recovery ──────────────────────────────────────────────────
    { section: 'Backup — automatic backup scheduling' },
    { key: 'INDEX_SERVER_AUTO_BACKUP',             desc: 'Enable automatic backups (0=off, 1=on; defaults to on when mutation is enabled)', active: false, value: config.mutation ? '1' : '0' },
    { key: 'INDEX_SERVER_AUTO_BACKUP_INTERVAL_MS', desc: 'Backup interval in ms (default: 3600000 = 1 hour)', active: false, value: '3600000' },
    { key: 'INDEX_SERVER_AUTO_BACKUP_MAX_COUNT',   desc: 'Max backup snapshots to retain (default: 10)', active: false, value: '10' },
    { key: 'INDEX_SERVER_BACKUP_BEFORE_BULK_DELETE',desc: 'Auto-backup before bulk delete operations (0=off, 1=on)', active: false, value: '1' },

    // ── Features & Flags ───────────────────────────────────────────────────
    { section: 'Features — feature flags and capabilities' },
    { key: 'INDEX_SERVER_FEATURES',             desc: 'Comma-separated feature flags: usage,window,hotness,drift,risk', active: isEnhanced, value: isEnhanced ? 'usage' : '' },
    { key: 'INDEX_SERVER_METRICS_FILE_STORAGE', desc: 'Persist metrics to disk (0=off, 1=on)', active: isEnhanced, value: isEnhanced ? '1' : '0' },
    { key: 'INDEX_SERVER_METRICS_DIR',          desc: 'Metrics storage directory', active: isEnhanced, value: paths.metrics },
    { key: 'INDEX_SERVER_FLAGS_FILE',           desc: 'Feature flags JSON file path', active: false, value: paths.flags },

    // ── Server & Transport ─────────────────────────────────────────────────
    { section: 'Server — MCP transport and instance mode' },
    { key: 'INDEX_SERVER_MODE',                     desc: 'Instance mode: standalone | leader | follower | auto', active: false, value: 'standalone' },
    { key: 'INDEX_SERVER_DISABLE_EARLY_STDIN_BUFFER',desc: 'Disable stdin handshake hardening (0=off, 1=on)', active: false, value: '0' },
    { key: 'INDEX_SERVER_IDLE_KEEPALIVE_MS',        desc: 'Keepalive interval in ms (default: 30000)', active: false, value: '30000' },
    { key: 'INDEX_SERVER_POLL_MS',                  desc: 'Index filesystem poll interval in ms (default: 10000)', active: false, value: '10000' },

    // ── Advanced Tuning ────────────────────────────────────────────────────
    { section: 'Advanced — tuning, limits, governance (most users can skip)' },
    { key: 'INDEX_SERVER_BODY_WARN_LENGTH',       desc: 'Max instruction body length in chars (default: 100000)', active: false, value: '100000' },
    { key: 'INDEX_SERVER_AUTO_SPLIT_OVERSIZED',  desc: 'Auto-split oversized entries on load (0=off, 1=on)', active: false, value: '0' },
    { key: 'INDEX_SERVER_READ_RETRIES',          desc: 'File read retry attempts (default: 3)', active: false, value: '3' },
    { key: 'INDEX_SERVER_MAX_BULK_DELETE',        desc: 'Max entries in a single bulk delete (default: 5)', active: false, value: '5' },
    { key: 'INDEX_SERVER_FEEDBACK_MAX_ENTRIES',   desc: 'Max feedback entries before rotation (default: 1000)', active: false, value: '1000' },
    { key: 'INDEX_SERVER_MESSAGING_MAX',          desc: 'Max messages in queue (default: 10000)', active: false, value: '10000' },
    { key: 'INDEX_SERVER_MAX_CONNECTIONS',        desc: 'Max concurrent dashboard connections (default: 100)', active: false, value: '100' },
    { key: 'INDEX_SERVER_CACHE_MODE',             desc: 'Index cache mode: normal | memoize | memoize+hash | reload | reload+memo', active: false, value: 'normal' },
    { key: 'INDEX_SERVER_WORKSPACE',              desc: 'Workspace identifier for multi-tenant setups', active: false, value: '' },
    { key: 'INDEX_SERVER_AGENT_ID',               desc: 'Agent identifier for audit trails', active: false, value: '' },
  ];
}

// --------------------------------------------------------------------------
// Generate .vscode/mcp.json snippet (JSONC with comments)
// --------------------------------------------------------------------------
function generateMcpJson(config, paths) {
  const catalog = getEnvCatalog(config, paths);
  const indent = '\t\t\t\t';
  const launch = resolveServerLaunch(config);
  const argsJson = JSON.stringify(launch.args);

  const lines = [
    '{',
    '\t"servers": {',
    `\t\t"${config.serverName}": {`,
    '\t\t\t"type": "stdio",',
    `\t\t\t"cwd": "${fwd(launch.cwd)}",`,
    `\t\t\t"command": "${launch.command}",`,
    `\t\t\t"args": ${argsJson},`,
    '\t\t\t"env": {',
  ];

  let firstSection = true;
  for (const entry of catalog) {
    if (entry.section) {
      if (!firstSection) lines.push('');
      lines.push(`${indent}// ── ${entry.section} ${'─'.repeat(Math.max(0, 58 - entry.section.length))}`);
      firstSection = false;
      continue;
    }

    const comment = `// ${entry.desc}`;
    if (entry.active) {
      lines.push(`${indent}${comment}`);
      lines.push(`${indent}"${entry.key}": "${entry.value}",`);
    } else {
      lines.push(`${indent}${comment}`);
      lines.push(`${indent}// "${entry.key}": "${entry.value}",`);
    }
  }

  lines.push('\t\t\t}');
  lines.push('\t\t}');
  lines.push('\t},');
  lines.push('\t"inputs": []');
  lines.push('}');

  return lines.join('\n');
}

// --------------------------------------------------------------------------
// Generate Copilot CLI mcp-config.json format
// --------------------------------------------------------------------------
function generateCopilotCliJson(config, paths) {
  const catalog = getEnvCatalog(config, paths);
  const env = {};
  for (const entry of catalog) {
    if (entry.section) continue;
    if (entry.active) env[entry.key] = entry.value;
  }
  const launch = resolveServerLaunch(config);
  // copilot-cli doesn't reliably inherit cwd — use absolute args for local/packaged
  const args = launch.source === 'local'
    ? [fwd(path.resolve(launch.cwd, launch.args[0]))]
    : launch.args;
  const obj = {
    mcpServers: {
      [config.serverName]: {
        command: launch.command,
        args,
        env,
      },
    },
  };
  return JSON.stringify(obj, null, 2);
}

// --------------------------------------------------------------------------
// Generate Claude Desktop config JSON format
// --------------------------------------------------------------------------
function generateClaudeDesktopJson(config, paths) {
  const catalog = getEnvCatalog(config, paths);
  const env = {};
  for (const entry of catalog) {
    if (entry.section) continue;
    if (entry.active) env[entry.key] = entry.value;
  }
  const launch = resolveServerLaunch(config);
  // Claude Desktop doesn't support cwd — use absolute args for local/packaged
  const args = launch.source === 'local'
    ? [fwd(path.resolve(launch.cwd, launch.args[0]))]
    : launch.args;
  const obj = {
    mcpServers: {
      [config.serverName]: {
        command: launch.command,
        args,
        env,
      },
    },
  };
  return JSON.stringify(obj, null, 2);
}

// --------------------------------------------------------------------------
// Resolve target config file paths based on scope and OS
// --------------------------------------------------------------------------
function resolveConfigPaths(config) {
  const home = os.homedir();
  const results = [];
  const isWin = process.platform === 'win32';

  for (const target of (config.targets || ['vscode'])) {
    if (target === 'vscode') {
      if (config.scope === 'global') {
        const dir = isWin
          ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code', 'User')
          : path.join(home, '.config', 'Code', 'User');
        results.push({ target, path: path.join(dir, 'settings.json'), format: 'vscode-global' });
      } else {
        results.push({ target, path: path.join(config.root, '.vscode', 'mcp.json'), format: 'vscode' });
      }
    } else if (target === 'copilot-cli') {
      const dir = isWin
        ? path.join(process.env.USERPROFILE || home, '.copilot')
        : path.join(home, '.copilot');
      results.push({ target, path: path.join(dir, 'mcp-config.json'), format: 'copilot-cli' });
    } else if (target === 'claude') {
      const dir = isWin
        ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude')
        : path.join(home, 'Library', 'Application Support', 'Claude');
      results.push({ target, path: path.join(dir, 'claude_desktop_config.json'), format: 'claude' });
    }
  }
  return results;
}

// --------------------------------------------------------------------------
// Generate config content for a given format
// --------------------------------------------------------------------------
function generateConfigForTarget(format, config, paths) {
  switch (format) {
    case 'vscode':
    case 'vscode-global':
      return generateMcpJson(config, paths);
    case 'copilot-cli':
      return generateCopilotCliJson(config, paths);
    case 'claude':
      return generateClaudeDesktopJson(config, paths);
    default:
      return generateMcpJson(config, paths);
  }
}

// --------------------------------------------------------------------------
// Preview all generated configs
// --------------------------------------------------------------------------
function previewConfigs(configTargets, config, paths) {
  console.log('\n┌─────────────────────────────────────────────────────────────────────┐');
  console.log('│                     📋 Configuration Preview                        │');
  console.log('└─────────────────────────────────────────────────────────────────────┘');
  for (const ct of configTargets) {
    const content = generateConfigForTarget(ct.format, config, paths);
    console.log(`\n── ${ct.target} → ${ct.path} ──\n`);
    console.log(content);
  }
  console.log('');
}

// --------------------------------------------------------------------------
// Write config to real file (merge if existing)
// --------------------------------------------------------------------------
function writeConfigFile(targetInfo, content) {
  const dir = path.dirname(targetInfo.path);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (targetInfo.format === 'vscode-global' && fs.existsSync(targetInfo.path)) {
    // Write sidecar to avoid corrupting settings.json
    const sidecarPath = targetInfo.path.replace('settings.json', 'mcp.json.generated');
    fs.writeFileSync(sidecarPath, content, 'utf8');
    console.log(`  ✅ Generated: ${sidecarPath}`);
    console.log(`     ℹ️  Merge the "mcp" key into your settings.json manually.`);
    return;
  }

  if (fs.existsSync(targetInfo.path)) {
    // Backup existing file before overwriting
    const backup = targetInfo.path + '.backup.' + Date.now();
    fs.copyFileSync(targetInfo.path, backup);
    console.log(`  📦 Backed up existing: ${backup}`);

    // For JSON files, try to merge the mcpServers key
    try {
      const existing = JSON.parse(fs.readFileSync(targetInfo.path, 'utf8'));
      const generated = JSON.parse(content);

      if (targetInfo.format === 'copilot-cli' || targetInfo.format === 'claude') {
        existing.mcpServers = { ...existing.mcpServers, ...generated.mcpServers };
        fs.writeFileSync(targetInfo.path, JSON.stringify(existing, null, 2), 'utf8'); // lgtm[js/file-system-race] — setup wizard writes user-provided config target; race acceptable in CLI tooling
        console.log(`  ✅ Merged into: ${targetInfo.path}`);
        return;
      }
    } catch {
      // Not valid JSON — fall through to overwrite
    }
  }

  fs.writeFileSync(targetInfo.path, content, 'utf8'); // lgtm[js/file-system-race] — setup wizard writes user-provided config target; race acceptable in CLI tooling
  console.log(`  ✅ Written: ${targetInfo.path}`);
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
      fs.writeFileSync(targetPkg, JSON.stringify(minPkg, null, 2), 'utf8');
    }

    console.log('   Installing package (this may take a moment)...');

    // Strategy: pack the current package into a tarball, then install it.
    // This works regardless of whether the version is published to npm,
    // and produces a proper self-contained node_modules tree.
    const packOutput = runNpm(
      ['pack', '--pack-destination', targetRoot],
      { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'], timeout: 30_000 }
    ).toString().trim();
    const tarballName = packOutput.split('\n').pop();

    const tarballPath = path.join(targetRoot, tarballName);

    try {
      // Install from the local tarball
      runNpm(
        ['install', tarballPath, '--omit=dev', '--no-fund', '--no-audit'],
        { cwd: targetRoot, stdio: 'inherit', timeout: 120_000 }
      );
    } finally {
      // Clean up tarball
      try { fs.unlinkSync(tarballPath); } catch { /* ok */ }
    }

    // Create convenience symlinks/junctions so "dist/" at root resolves
    const installedDist = path.join(targetRoot, 'node_modules', pkgName, 'dist');
    const targetDist = path.join(targetRoot, 'dist');
    if (fs.existsSync(installedDist) && !fs.existsSync(targetDist)) {
      try {
        // On Windows, directory junctions don't require elevated privileges
        fs.symlinkSync(installedDist, targetDist, 'junction');
      } catch {
        // Fallback: copy dist recursively
        fs.cpSync(installedDist, targetDist, { recursive: true });
      }
    }

    // Copy schemas if not present
    const installedSchemas = path.join(targetRoot, 'node_modules', pkgName, 'schemas');
    const targetSchemas = path.join(targetRoot, 'schemas');
    if (fs.existsSync(installedSchemas) && !fs.existsSync(targetSchemas)) {
      fs.cpSync(installedSchemas, targetSchemas, { recursive: true });
    }

    // Update the runtime package.json with correct version/start script
    try {
      const runtimePkg = JSON.parse(fs.readFileSync(targetPkg, 'utf8'));
      runtimePkg.version = sourceVersion;
      runtimePkg.scripts = runtimePkg.scripts || {};
      runtimePkg.scripts.start = 'node dist/server/index-server.js';
      fs.writeFileSync(targetPkg, JSON.stringify(runtimePkg, null, 2) + '\n', 'utf8');
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
  node scripts/setup-wizard.mjs

Non-interactive mode:
  node scripts/setup-wizard.mjs --non-interactive [options]
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
    fs.writeFileSync(genPath, envContent, 'utf8');
    console.log(`\n⚠️  .env already exists. Written to: ${genPath}`);
  } else {
    fs.writeFileSync(envPath, envContent, 'utf8'); // lgtm[js/file-system-race] — setup wizard writes .env to user-supplied path; race acceptable in CLI tooling
    console.log(`\n✅ .env written to: ${envPath}`);
  }

  // ── Multi-target config generation ──────────────────────────────────
  const configTargets = resolveConfigPaths(config);

  // Preview
  if (config.preview !== false) {
    previewConfigs(configTargets, config, paths);
  }

  // Write to real files or sidecar
  if (config.write) {
    console.log('📁 Writing configuration files...\n');
    for (const ct of configTargets) {
      const content = generateConfigForTarget(ct.format, config, paths);
      writeConfigFile(ct, content);
    }
  } else {
    // Legacy sidecar behavior for backward compatibility
    const mcpContent = generateMcpJson(config, paths);
    const mcpDir = path.join(config.root, '.vscode');
    const mcpPath = path.join(mcpDir, 'mcp.json.generated');

    try {
      fs.mkdirSync(mcpDir, { recursive: true });
    } catch { /* exists */ }
    fs.writeFileSync(mcpPath, mcpContent, 'utf8');
    console.log(`✅ mcp.json snippet written to: ${mcpPath}`);
    console.log('   Copy its contents into your .vscode/mcp.json or VS Code user settings.');

    // Also generate Copilot CLI / Claude if requested
    for (const ct of configTargets) {
      if (ct.format !== 'vscode' && ct.format !== 'vscode-global') {
        const content = generateConfigForTarget(ct.format, config, paths);
        const genPath = ct.path + '.generated';
        const dir = path.dirname(genPath);
        try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
        fs.writeFileSync(genPath, content, 'utf8');
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
        [path.join(ROOT, 'scripts', 'generate-certs.mjs'), '--hostname', 'localhost', '--output', certDir],
        { stdio: 'inherit' }
      );
    } catch {
      console.error('❌ Certificate generation failed. Run manually:');
      console.error(`   node scripts/generate-certs.mjs --output "${path.join(config.root, 'certs')}"`);
    }
  }

  // ── Next steps ──────────────────────────────────────────────────────
  const proto = (config.profile === 'enhanced' || config.profile === 'experimental') ? 'https' : 'http';
  const launch = resolveServerLaunch(config);
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                         Next Steps                            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  let step = 1;
  if (launch.source === 'packaged') {
    console.log(`  ${step}. Build the server:`);
    console.log('     npm run build\n');
    step++;
  } else if (launch.source === 'npx') {
    console.log(`  ${step}. The server will be fetched via npx on first start.\n`);
    step++;
  }

  if (config.write) {
    console.log(`  ${step}. Config files have been written. Restart your MCP client.\n`);
    step++;
  } else {
    console.log(`  ${step}. Copy generated config into your MCP client settings.`);

    for (const ct of configTargets) {
      const genPath = ct.format === 'vscode' || ct.format === 'vscode-global'
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

  console.log(`  Targets: ${(config.targets || ['vscode']).join(', ')} | Scope: ${config.scope || 'repo'}`);
  console.log(`  Profile: ${config.profile} | Root: ${fwd(config.root)}`);
  console.log('');
}

main().catch(err => {
  console.error('Setup wizard error:', err);
  process.exit(1);
});
