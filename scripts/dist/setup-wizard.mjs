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
 *   node scripts/setup-wizard.mjs
 *   node scripts/setup-wizard.mjs --non-interactive --profile enhanced --root C:/mcp/index-server
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IS_WINDOWS = process.platform === 'win32';

// --------------------------------------------------------------------------
// Path helpers
// --------------------------------------------------------------------------
/** Normalize to forward slashes for mcp.json compatibility. */
function fwd(p) { return p.replace(/\\/g, '/'); }

/** Resolve a sub-path under a root, always absolute and forward-slashed. */
function resolveUnder(root, ...segments) { return fwd(path.resolve(root, ...segments)); }

// --------------------------------------------------------------------------
// Prompt helpers
// --------------------------------------------------------------------------
function createPrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask(question, defaultVal) {
      return new Promise(resolve => {
        const suffix = defaultVal !== undefined ? ` [${defaultVal}]` : '';
        rl.question(`${question}${suffix}: `, answer => {
          resolve(answer.trim() || (defaultVal !== undefined ? String(defaultVal) : ''));
        });
      });
    },
    confirm(question, defaultVal = false) {
      return new Promise(resolve => {
        const hint = defaultVal ? '[Y/n]' : '[y/N]';
        rl.question(`${question} ${hint}: `, answer => {
          const a = answer.trim().toLowerCase();
          if (!a) return resolve(defaultVal);
          resolve(a === 'y' || a === 'yes');
        });
      });
    },
    choose(question, options, defaultIdx = 0) {
      return new Promise(resolve => {
        console.log(`\n${question}`);
        options.forEach((opt, i) => {
          const marker = i === defaultIdx ? ' (default)' : '';
          console.log(`  ${i + 1}. ${opt}${marker}`);
        });
        rl.question(`Choice [${defaultIdx + 1}]: `, answer => {
          const idx = parseInt(answer.trim(), 10) - 1;
          resolve(idx >= 0 && idx < options.length ? idx : defaultIdx);
        });
      });
    },
    close() { rl.close(); },
  };
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
    mutation: true,
    logLevel: 'info',
    generateCerts: false,
    serverName: 'index-server',
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) config.profile = args[++i];
    else if (args[i] === '--root' && args[i + 1]) config.root = path.resolve(args[++i]);
    else if (args[i] === '--port' && args[i + 1]) config.port = parseInt(args[++i], 10);
    else if (args[i] === '--host' && args[i + 1]) config.host = args[++i];
    else if (args[i] === '--mutation') config.mutation = true;
    else if (args[i] === '--log-level' && args[i + 1]) config.logLevel = args[++i];
    else if (args[i] === '--generate-certs') config.generateCerts = true;
    else if (args[i] === '--server-name' && args[i + 1]) config.serverName = args[++i];
  }

  // Profile overrides
  if (config.profile === 'enhanced' || config.profile === 'experimental') {
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
  const prompt = createPrompt();

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║             Index Server — Configuration Wizard               ║');
  console.log('║      MCP instruction indexing for AI governance               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Profile
  console.log('Choose a configuration profile:\n');
  const profileKeys = Object.keys(PROFILES);
  for (let i = 0; i < profileKeys.length; i++) {
    const p = PROFILES[profileKeys[i]];
    const marker = i === 0 ? ' (default)' : '';
    console.log(`  ${i + 1}. ${p.label}${marker}`);
    p.description.forEach(line => console.log(`     ${line}`));
    console.log('');
  }
  const profileIdx = await prompt.choose('Select profile', profileKeys.map(k => PROFILES[k].label), 0);
  const profile = profileKeys[profileIdx];

  // Step 2: Root directory
  const defaultRoot = IS_WINDOWS ? 'C:\\mcp\\index-server' : '/opt/index-server';
  console.log('\nBase directory — all data paths resolve under this root.');
  console.log('Use the repo directory for development, or a dedicated path for production.');
  const root = path.resolve(await prompt.ask('Base directory', defaultRoot));

  // Step 3: Server name for mcp.json entry
  const serverName = await prompt.ask('MCP server name (used in mcp.json)', 'index-server');

  // Step 4: Dashboard port
  const port = parseInt(await prompt.ask('Dashboard port', 8787), 10);

  // Step 5: Dashboard host
  const host = await prompt.ask(
    'Dashboard host (127.0.0.1 = localhost only, 0.0.0.0 = all interfaces)',
    '127.0.0.1'
  );

  // Step 6: TLS certs (Enhanced/Experimental)
  let generateCerts = false;
  if (profile === 'enhanced' || profile === 'experimental') {
    generateCerts = await prompt.confirm('Generate self-signed TLS certificates now?', true);
  }

  // Step 7: Mutation
  let mutation = true;
  if (profile === 'default') {
    mutation = await prompt.confirm('Enable mutation (write operations)?', true);
  }

  // Step 8: Log level
  const defaultLogLevel = profile === 'experimental' ? 'debug' : 'info';
  const logLevelIdx = await prompt.choose(
    'Log level',
    ['error', 'warn', 'info', 'debug', 'trace'],
    ['error', 'warn', 'info', 'debug', 'trace'].indexOf(defaultLogLevel)
  );
  const logLevel = ['error', 'warn', 'info', 'debug', 'trace'][logLevelIdx];

  prompt.close();

  return { profile, root, serverName, port, host, mutation, logLevel, generateCerts };
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
  const tls = isEnhanced;

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

  const lines = [
    '{',
    '\t"servers": {',
    `\t\t"${config.serverName}": {`,
    '\t\t\t"type": "stdio",',
    `\t\t\t"cwd": "${fwd(config.root)}",`,
    '\t\t\t"command": "node",',
    '\t\t\t"args": ["dist/server/index-server.js"],',
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
// Main
// --------------------------------------------------------------------------
async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Usage: setup-wizard.mjs [options]

Interactive mode:
  node scripts/setup-wizard.mjs

Non-interactive mode:
  node scripts/setup-wizard.mjs --non-interactive [options]
    --profile <name>    default | enhanced | experimental
    --root <dir>        Base directory for all data paths
    --port <n>          Dashboard port (default: 8787)
    --host <addr>       Dashboard host (default: 127.0.0.1)
    --mutation          Enable write operations
    --log-level <lvl>   Log level: error|warn|info|debug|trace
    --generate-certs    Generate self-signed TLS certificates
    --server-name <n>   MCP server name in mcp.json (default: index-server)`);
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

  // ── Generate mcp.json snippet ───────────────────────────────────────
  const mcpContent = generateMcpJson(config, paths);
  const mcpDir = path.join(config.root, '.vscode');
  const mcpPath = path.join(mcpDir, 'mcp.json.generated');

  try {
    fs.mkdirSync(mcpDir, { recursive: true });
  } catch { /* exists */ }
  fs.writeFileSync(mcpPath, mcpContent, 'utf8');
  console.log(`✅ mcp.json snippet written to: ${mcpPath}`);
  console.log('   Copy its contents into your .vscode/mcp.json or VS Code user settings.');

  // ── Generate TLS certs ──────────────────────────────────────────────
  if (config.generateCerts) {
    console.log('\n🔐 Generating TLS certificates...');
    try {
      const { execFileSync } = await import('child_process');
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
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                         Next Steps                            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  console.log('  1. Build the server:');
  console.log('     npm run build\n');
  console.log('  2. Copy mcp.json config into your VS Code settings:');
  console.log(`     ${mcpPath}\n`);
  console.log(`  3. Open the dashboard:`);
  console.log(`     ${proto}://localhost:${config.port}\n`);

  if (config.profile === 'enhanced' || config.profile === 'experimental') {
    console.log('  4. First-time semantic search:');
    console.log('     The MiniLM model (~90MB) will download on first query.');
    console.log(`     Model cache: ${paths.modelCache}\n`);
  }

  if (config.profile === 'experimental') {
    console.log('  ⚠️  SQLite backend is experimental. Your data is in:');
    console.log(`     ${paths.sqliteDb}\n`);
  }

  console.log(`  Profile: ${config.profile} | Root: ${fwd(config.root)}`);
  console.log('');
}

main().catch(err => {
  console.error('Setup wizard error:', err);
  process.exit(1);
});
