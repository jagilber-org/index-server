#!/usr/bin/env node
/**
 * setup-wizard.mjs — Interactive configuration wizard for Index Server.
 *
 * Guides users through initial setup: port, TLS, mutation, logging, Docker mode.
 * Generates a .env file and optionally generates TLS certificates.
 *
 * Usage:
 *   node scripts/setup-wizard.mjs
 *   node scripts/setup-wizard.mjs --non-interactive --port 8787 --tls --mutation
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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
// Non-interactive mode
// --------------------------------------------------------------------------
function parseNonInteractiveArgs() {
  const args = process.argv.slice(2);
  if (!args.includes('--non-interactive')) return null;

  const config = {
    port: 8787,
    host: '0.0.0.0',
    tls: false,
    tlsHostname: 'localhost',
    mutation: false,
    logLevel: 'info',
    mode: 'docker',
    generateCerts: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) config.port = parseInt(args[++i], 10);
    else if (args[i] === '--host' && args[i + 1]) config.host = args[++i];
    else if (args[i] === '--tls') config.tls = true;
    else if (args[i] === '--tls-hostname' && args[i + 1]) config.tlsHostname = args[++i];
    else if (args[i] === '--mutation') config.mutation = true;
    else if (args[i] === '--log-level' && args[i + 1]) config.logLevel = args[++i];
    else if (args[i] === '--mode' && args[i + 1]) config.mode = args[++i];
    else if (args[i] === '--generate-certs') config.generateCerts = true;
  }
  return config;
}

// --------------------------------------------------------------------------
// Interactive wizard
// --------------------------------------------------------------------------
async function runInteractiveWizard() {
  const prompt = createPrompt();

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║        Index Server — Configuration Wizard          ║');
  console.log('║  MCP instruction indexing for AI governance         ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // Step 1: Deployment mode
  const modeIdx = await prompt.choose(
    'How will you run Index Server?',
    ['Docker (recommended)', 'Docker with HTTPS', 'Standalone Node.js', 'Standalone with HTTPS'],
    0
  );
  const modes = ['docker', 'docker-tls', 'standalone', 'standalone-tls'];
  const mode = modes[modeIdx];
  const tls = mode.includes('tls');

  // Step 2: Dashboard port
  const port = parseInt(await prompt.ask('Dashboard port', 8787), 10);

  // Step 3: Dashboard host binding
  const host = await prompt.ask(
    'Dashboard host (0.0.0.0 = all interfaces, 127.0.0.1 = localhost only)',
    mode.startsWith('docker') ? '0.0.0.0' : '127.0.0.1'
  );

  // Step 4: TLS configuration
  let tlsHostname = 'localhost';
  let generateCerts = false;
  if (tls) {
    tlsHostname = await prompt.ask('TLS certificate hostname', 'localhost');
    generateCerts = await prompt.confirm('Generate self-signed certificates now?', true);
  }

  // Step 5: Mutation (write operations)
  const mutation = await prompt.confirm(
    'Enable mutation (write operations: add, update, delete instructions)?',
    false
  );

  // Step 6: Log level
  const logLevelIdx = await prompt.choose(
    'Log level',
    ['error', 'warn', 'info', 'debug', 'trace'],
    2
  );
  const logLevel = ['error', 'warn', 'info', 'debug', 'trace'][logLevelIdx];

  prompt.close();

  return { port, host, tls, tlsHostname, mutation, logLevel, mode, generateCerts };
}

// --------------------------------------------------------------------------
// Generate .env file
// --------------------------------------------------------------------------
function generateEnvFile(config) {
  const lines = [
    '# Index Server Configuration',
    `# Generated by setup wizard on ${new Date().toISOString()}`,
    '#',
    '# Dashboard',
    `INDEX_SERVER_DASHBOARD=1`,
    `INDEX_SERVER_DASHBOARD_PORT=${config.port}`,
    `INDEX_SERVER_DASHBOARD_HOST=${config.host}`,
    '',
  ];

  if (config.tls) {
    const certDir = config.mode.startsWith('docker') ? '/app/certs' : path.join(ROOT, 'certs');
    lines.push(
      '# TLS / HTTPS',
      'INDEX_SERVER_DASHBOARD_TLS=1',
      `INDEX_SERVER_DASHBOARD_TLS_CERT=${certDir}/server.crt`,
      `INDEX_SERVER_DASHBOARD_TLS_KEY=${certDir}/server.key`,
      ''
    );
  }

  lines.push(
    '# Operations',
    `INDEX_SERVER_MUTATION=${config.mutation ? '1' : '0'}`,
    `INDEX_SERVER_LOG_LEVEL=${config.logLevel}`,
    '',
    '# Paths (Docker defaults)',
    `INDEX_SERVER_DIR=${config.mode.startsWith('docker') ? '/app/instructions' : path.join(ROOT, 'instructions')}`,
    `INDEX_SERVER_METRICS_DIR=${config.mode.startsWith('docker') ? '/app/metrics' : path.join(ROOT, 'metrics')}`,
    `INDEX_SERVER_FEEDBACK_DIR=${config.mode.startsWith('docker') ? '/app/feedback' : path.join(ROOT, 'feedback')}`,
    ''
  );

  return lines.join('\n');
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------
async function main() {
  // Check for --help
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Usage: setup-wizard.mjs [options]
  
Interactive mode:
  node scripts/setup-wizard.mjs

Non-interactive mode:
  node scripts/setup-wizard.mjs --non-interactive [options]
    --port <n>          Dashboard port (default: 8787)
    --host <addr>       Dashboard host (default: 0.0.0.0)
    --tls               Enable HTTPS
    --tls-hostname <n>  TLS cert hostname (default: localhost)
    --mutation          Enable write operations
    --log-level <lvl>   Log level: error|warn|info|debug|trace
    --mode <m>          docker|docker-tls|standalone|standalone-tls
    --generate-certs    Generate self-signed TLS certificates`);
    process.exit(0);
  }

  let config = parseNonInteractiveArgs();
  if (!config) {
    config = await runInteractiveWizard();
  }

  // Generate .env file
  const envContent = generateEnvFile(config);
  const envPath = path.join(ROOT, '.env');

  if (fs.existsSync(envPath)) {
    console.log('\n⚠️  .env file already exists. Writing to .env.generated instead.');
    fs.writeFileSync(path.join(ROOT, '.env.generated'), envContent, 'utf8');
    console.log(`   Written to: ${path.join(ROOT, '.env.generated')}`);
  } else {
    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log(`\n✅ Configuration written to: ${envPath}`);
  }

  // Generate TLS certs if requested
  if (config.generateCerts || (config.tls && config.generateCerts !== false)) {
    console.log('\n🔐 Generating TLS certificates...');
    try {
      const { execFileSync } = await import('child_process');
      execFileSync(
        process.execPath,
        [path.join(ROOT, 'scripts', 'generate-certs.mjs'), '--hostname', config.tlsHostname],
        { stdio: 'inherit' }
      );
    } catch (e) {
      console.error('❌ Certificate generation failed. You can run it manually:');
      console.error('   node scripts/generate-certs.mjs');
    }
  }

  // Print next steps
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║                    Next Steps                       ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  if (config.mode === 'docker') {
    console.log('  docker compose up -d');
    console.log(`  open http://localhost:${config.port}`);
  } else if (config.mode === 'docker-tls') {
    console.log('  docker compose --profile tls up -d');
    console.log(`  open https://localhost:${config.port}`);
  } else if (config.mode === 'standalone') {
    console.log('  npm run build');
    console.log('  node dist/server/index-server.js --dashboard');
    console.log(`  open http://localhost:${config.port}`);
  } else {
    console.log('  npm run build');
    console.log('  node dist/server/index-server.js --dashboard --dashboard-tls');
    console.log(`  open https://localhost:${config.port}`);
  }
  console.log('');
}

main().catch(err => {
  console.error('Setup wizard error:', err);
  process.exit(1);
});
