#!/usr/bin/env node
/**
 * uninstall-wizard.mjs — Interactive uninstall / clean wizard for Index Server.
 *
 * Mirrors setup-wizard.mjs in style. Asks the user what to remove:
 *   - Data directories under <base> (instructions, feedback, state, messaging,
 *     audit log, logs, metrics, model cache, embeddings, sqlite DB, certs)
 *   - Backups directory (often on a different drive)
 *   - .env file
 *   - Entire <base> directory (atomic)
 *   - MCP client config entries (vscode global, copilot-cli, claude)
 *   - Global npm package (@jagilber-org/index-server)
 *   - Stale local install at $HOME/node_modules/@jagilber-org/index-server
 *
 * Usage:
 *   npx @jagilber-org/index-server --uninstall
 *   index-server --uninstall
 *   node scripts/build/uninstall-wizard.mjs
 *   node scripts/build/uninstall-wizard.mjs --non-interactive --root <dir> --all
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { input, confirm, checkbox } from '@inquirer/prompts';
import { defaultUserRoot } from './setup-wizard-paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);
const mcpConfig = require(path.join(ROOT, 'dist', 'services', 'mcpConfig'));

const PKG_NAME = '@jagilber-org/index-server';

function fwd(p) { return p.replace(/\\/g, '/'); }

function findNpmCli() {
  if (process.env.npm_execpath) return process.env.npm_execpath;
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function runNpm(args, opts = {}) {
  const npmCli = findNpmCli();
  if (npmCli) return execFileSync(process.execPath, [npmCli, ...args], opts);
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return execFileSync(npmBin, args, opts);
}

function safeRm(target, label, removed) {
  if (!fs.existsSync(target)) {
    console.log(`  ⏭️  ${label}: not present (${fwd(target)})`);
    return;
  }
  try {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`  ✅ Removed ${label}: ${fwd(target)}`);
    removed.push({ label, path: target });
  } catch (err) {
    console.error(`  ❌ Failed to remove ${label}: ${fwd(target)} — ${err.message}`);
  }
}

function parseNonInteractive() {
  const args = process.argv.slice(2);
  if (!args.includes('--non-interactive')) return null;
  const cfg = {
    root: defaultUserRoot(),
    targets: [],
    selections: new Set(),
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--root' && args[i + 1]) cfg.root = path.resolve(args[++i]);
    else if (a === '--all') {
      for (const k of [
        'base', 'env', 'instructions', 'feedback', 'state', 'messaging', 'audit',
        'logs', 'metrics', 'model-cache', 'embeddings', 'sqlite', 'certs', 'backups',
        'mcp-vscode-global', 'mcp-copilot-cli', 'mcp-claude',
        'npm-global', 'stale-local',
      ]) cfg.selections.add(k);
    }
    else if (a === '--remove' && args[i + 1]) {
      for (const s of args[++i].split(',')) cfg.selections.add(s.trim());
    }
  }
  return cfg;
}

function printBanner() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║             Index Server — Uninstall / Clean Wizard           ║');
  console.log('║      Remove data, configs, and/or the npm package             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  console.log('  ⚠️  This wizard permanently deletes files. Selections are previewed');
  console.log('     and confirmed before anything is removed.\n');
}

async function runInteractive() {
  printBanner();

  const root = path.resolve(await input({
    message: 'Base directory used by Index Server (data root)',
    default: defaultUserRoot(),
  }));

  const paths = mcpConfig.resolveDataPaths(root);
  const home = os.homedir();
  const staleLocal = path.join(home, 'node_modules', '@jagilber-org', 'index-server');

  // Resolve MCP client config targets for global scope (most common).
  const mcpTargets = {
    'mcp-vscode-global': mcpConfig.resolveConfigTargets({ targets: ['vscode'], scope: 'global', root }),
    'mcp-copilot-cli':   mcpConfig.resolveConfigTargets({ targets: ['copilot-cli'], root }),
    'mcp-claude':        mcpConfig.resolveConfigTargets({ targets: ['claude'], root }),
  };

  const fileLabel = (p) => `${fwd(p)}${fs.existsSync(p) ? '' : ' (not present)'}`;

  // Data path choices — each is independent.
  const dataChoices = [
    { name: `Instructions       — ${fileLabel(paths.instructions)}`, value: 'instructions' },
    { name: `Feedback           — ${fileLabel(paths.feedback)}`, value: 'feedback' },
    { name: `State              — ${fileLabel(paths.state)}`, value: 'state' },
    { name: `Messaging          — ${fileLabel(paths.messaging)}`, value: 'messaging' },
    { name: `Audit log          — ${fileLabel(paths.auditLog)}`, value: 'audit' },
    { name: `Log files          — ${fileLabel(path.dirname(paths.logFile))}`, value: 'logs' },
    { name: `Metrics            — ${fileLabel(paths.metrics)}`, value: 'metrics' },
    { name: `Model cache        — ${fileLabel(paths.modelCache)}`, value: 'model-cache' },
    { name: `Embeddings         — ${fileLabel(paths.embeddings)}`, value: 'embeddings' },
    { name: `SQLite DB          — ${fileLabel(paths.sqliteDb)}`, value: 'sqlite' },
    { name: `TLS certs          — ${fileLabel(path.join(root, 'certs'))}`, value: 'certs' },
    { name: `.env file          — ${fileLabel(path.join(root, '.env'))}`, value: 'env' },
    { name: `Backups directory  — ${fileLabel(paths.backups)} ⚠️  off-disk recommended`, value: 'backups' },
    { name: `ENTIRE base dir    — ${fileLabel(root)} (removes everything under it)`, value: 'base' },
  ];

  const mcpChoices = [
    {
      name: `VS Code (global)   — ${mcpTargets['mcp-vscode-global'].map(t => fileLabel(t.path)).join(' ; ')}`,
      value: 'mcp-vscode-global',
    },
    {
      name: `Copilot CLI        — ${mcpTargets['mcp-copilot-cli'].map(t => fileLabel(t.path)).join(' ; ')}`,
      value: 'mcp-copilot-cli',
    },
    {
      name: `Claude Desktop     — ${mcpTargets['mcp-claude'].map(t => fileLabel(t.path)).join(' ; ')}`,
      value: 'mcp-claude',
    },
  ];

  const pkgChoices = [
    { name: `Global npm package — npm uninstall -g ${PKG_NAME}`, value: 'npm-global' },
    { name: `Stale local install — ${fileLabel(staleLocal)}`, value: 'stale-local' },
  ];

  const selectedData = await checkbox({
    message: 'Select DATA paths to remove (space to toggle, enter to confirm)',
    choices: dataChoices,
    pageSize: dataChoices.length,
  });

  const selectedMcp = await checkbox({
    message: 'Select MCP client configs to remove the index-server entry from',
    choices: mcpChoices,
    pageSize: mcpChoices.length,
  });

  const selectedPkg = await checkbox({
    message: 'Select package installations to remove',
    choices: pkgChoices,
    pageSize: pkgChoices.length,
  });

  const selections = new Set([...selectedData, ...selectedMcp, ...selectedPkg]);
  return { root, selections, paths, mcpTargets, staleLocal };
}

async function execute(ctx) {
  const { root, selections, paths, mcpTargets, staleLocal } = ctx;
  const removed = [];

  if (selections.size === 0) {
    console.log('\nNothing selected. Exiting.\n');
    return;
  }

  console.log('\n┌─────────────────────────────────────────────────────────────────────┐');
  console.log('│                     🗑️  Removal Plan                                 │');
  console.log('└─────────────────────────────────────────────────────────────────────┘');
  for (const s of selections) console.log(`  • ${s}`);
  console.log('');

  const ok = await confirm({
    message: 'Proceed with removal? This is permanent.',
    default: false,
  });
  if (!ok) {
    console.log('\nAborted. Nothing was removed.\n');
    return;
  }

  console.log('');

  // ENTIRE base supersedes individual data entries under it.
  if (selections.has('base')) {
    safeRm(root, 'Entire base directory', removed);
  } else {
    if (selections.has('instructions')) safeRm(paths.instructions, 'instructions', removed);
    if (selections.has('feedback'))     safeRm(paths.feedback, 'feedback', removed);
    if (selections.has('state'))        safeRm(paths.state, 'state', removed);
    if (selections.has('messaging'))    safeRm(paths.messaging, 'messaging', removed);
    if (selections.has('audit'))        safeRm(paths.auditLog, 'audit log', removed);
    if (selections.has('logs'))         safeRm(path.dirname(paths.logFile), 'log files', removed);
    if (selections.has('metrics'))      safeRm(paths.metrics, 'metrics', removed);
    if (selections.has('model-cache'))  safeRm(paths.modelCache, 'model cache', removed);
    if (selections.has('embeddings'))   safeRm(paths.embeddings, 'embeddings', removed);
    if (selections.has('sqlite'))       safeRm(paths.sqliteDb, 'sqlite DB', removed);
    if (selections.has('certs'))        safeRm(path.join(root, 'certs'), 'TLS certs', removed);
    if (selections.has('env'))          safeRm(path.join(root, '.env'), '.env file', removed);
  }

  // Backups is intentionally treated separately so users with off-disk backups
  // don't lose them when they remove the base dir.
  if (selections.has('backups')) safeRm(paths.backups, 'backups', removed);

  // MCP client config entries
  for (const [sel, targets] of Object.entries(mcpTargets)) {
    if (!selections.has(sel)) continue;
    for (const t of targets) {
      if (!fs.existsSync(t.path)) {
        console.log(`  ⏭️  ${sel}: ${fwd(t.path)} (not present)`);
        continue;
      }
      try {
        const result = mcpConfig.removeServer({ target: t.target, scope: sel === 'mcp-vscode-global' ? 'global' : 'repo' });
        if (result.ok) {
          console.log(`  ✅ Removed index-server entry from ${sel}: ${fwd(t.path)}`);
          if (result.backupPath) console.log(`     📦 backup: ${fwd(result.backupPath)}`);
          removed.push({ label: sel, path: t.path });
        }
      } catch (err) {
        console.error(`  ❌ ${sel}: ${fwd(t.path)} — ${err.message}`);
      }
    }
  }

  // npm global package
  if (selections.has('npm-global')) {
    try {
      console.log(`  🔧 npm uninstall -g ${PKG_NAME} …`);
      runNpm(['uninstall', '-g', PKG_NAME], { stdio: 'inherit', timeout: 120_000 });
      console.log(`  ✅ Uninstalled global package ${PKG_NAME}`);
      removed.push({ label: 'global npm package', path: PKG_NAME });
    } catch (err) {
      console.error(`  ❌ Global uninstall failed: ${err.message}`);
    }
  }

  if (selections.has('stale-local')) {
    safeRm(staleLocal, 'stale local install', removed);
  }

  console.log('');
  console.log('┌─────────────────────────────────────────────────────────────────────┐');
  console.log('│                       ✅ Uninstall Complete                          │');
  console.log('└─────────────────────────────────────────────────────────────────────┘');
  console.log(`  Removed ${removed.length} item(s).`);
  if (selections.has('npm-global')) {
    console.log('  To reinstall later: npm install -g @jagilber-org/index-server');
  } else {
    console.log('  To re-run setup later: npx -y @jagilber-org/index-server@latest --setup');
  }
  console.log('');
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Usage: uninstall-wizard.mjs [options]

Interactive mode:
  npx @jagilber-org/index-server --uninstall
  index-server --uninstall
  node scripts/build/uninstall-wizard.mjs

Non-interactive mode:
  node scripts/build/uninstall-wizard.mjs --non-interactive [options]
    --root <dir>         Base directory (default: platform user dir)
    --all                Remove everything (data, MCP configs, global package, stale local)
    --remove <list>      Comma-separated selections, e.g.
                         base,env,instructions,feedback,state,messaging,audit,
                         logs,metrics,model-cache,embeddings,sqlite,certs,backups,
                         mcp-vscode-global,mcp-copilot-cli,mcp-claude,
                         npm-global,stale-local`);
    process.exit(0);
  }

  let ctx;
  const ni = parseNonInteractive();
  if (ni) {
    const paths = mcpConfig.resolveDataPaths(ni.root);
    const staleLocal = path.join(os.homedir(), 'node_modules', '@jagilber-org', 'index-server');
    const mcpTargets = {
      'mcp-vscode-global': mcpConfig.resolveConfigTargets({ targets: ['vscode'], scope: 'global', root: ni.root }),
      'mcp-copilot-cli':   mcpConfig.resolveConfigTargets({ targets: ['copilot-cli'], root: ni.root }),
      'mcp-claude':        mcpConfig.resolveConfigTargets({ targets: ['claude'], root: ni.root }),
    };
    ctx = { root: ni.root, selections: ni.selections, paths, mcpTargets, staleLocal };
  } else {
    ctx = await runInteractive();
  }
  await execute(ctx);
}

main().catch(err => {
  console.error('Uninstall wizard error:', err);
  process.exit(1);
});
