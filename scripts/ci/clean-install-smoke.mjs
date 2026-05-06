#!/usr/bin/env node
/**
 * Clean install smoke for the packed npm artifact.
 *
 * This intentionally installs the tarball into an empty npm prefix and runs the
 * generated binary shim from that prefix. It catches gaps that repo-checkout
 * tests miss, including missing package files and stale bin/setup paths.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const npmCmd = 'npm';
const npmShell = process.platform === 'win32';
const isWindows = process.platform === 'win32';
const npmInstallTimeoutMs = isWindows ? 420_000 : 180_000;
const setupTimeoutMs = isWindows ? 600_000 : 240_000;
const runtimeDeployInstallTimeoutMs = isWindows ? 420_000 : 180_000;

function runNpm(args, options = {}) {
  const result = spawnSync(npmCmd, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    shell: npmShell,
    timeout: options.timeout ?? 120_000,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): npm ${args.join(' ')}\n${output}`);
  }
  return output;
}

function runInstalledBin(binPath, args, env, timeout = 120_000) {
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  const result = spawnSync(binPath, args, {
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Installed binary failed (${result.status}): ${binPath} ${args.join(' ')}\n${output}`);
  }
  return output;
}

function logStep(message) {
  console.log(`[clean-install-smoke] ${message}`);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'index-server-clean-install-'));
const packDir = path.join(tmpRoot, 'pack');
const prefixDir = path.join(tmpRoot, 'npm-prefix');
const homeDir = path.join(tmpRoot, 'home');
const appDataDir = path.join(tmpRoot, 'appdata');
const deployRoot = path.join(tmpRoot, 'deploy-root');

fs.mkdirSync(packDir, { recursive: true });
fs.mkdirSync(prefixDir, { recursive: true });
fs.mkdirSync(homeDir, { recursive: true });
fs.mkdirSync(appDataDir, { recursive: true });
fs.mkdirSync(deployRoot, { recursive: true });

try {
  logStep(`Packing repo artifact into ${packDir}`);
  const packJson = runNpm(['pack', '--json', '--pack-destination', packDir], { timeout: 180_000 });
  const jsonStart = packJson.indexOf('[');
  const jsonEnd = packJson.lastIndexOf(']');
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    throw new Error(`Could not find npm pack JSON output:\n${packJson}`);
  }
  const pack = JSON.parse(packJson.slice(jsonStart, jsonEnd + 1))[0];
  const tarball = path.resolve(packDir, pack.filename);
  if (!fs.existsSync(tarball)) {
    throw new Error(`npm pack did not create expected tarball: ${tarball}`);
  }

  const cleanEnv = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: appDataDir,
    npm_config_cache: path.join(tmpRoot, 'npm-cache'),
    INDEX_SERVER_DASHBOARD: '0',
    INDEX_SERVER_SETUP_INSTALL_TIMEOUT_MS: String(runtimeDeployInstallTimeoutMs),
  };

  logStep(`Installing packed artifact into empty prefix ${prefixDir}`);
  runNpm(['install', '--global', '--prefix', prefixDir, '--no-audit', '--no-fund', tarball], {
    env: cleanEnv,
    timeout: npmInstallTimeoutMs,
  });

  const binPath = process.platform === 'win32'
    ? path.join(prefixDir, 'index-server.cmd')
    : path.join(prefixDir, 'bin', 'index-server');

  if (!fs.existsSync(binPath)) {
    throw new Error(`Installed binary shim not found: ${binPath}`);
  }

  logStep('Running installed binary --setup --help');
  const helpOutput = runInstalledBin(binPath, ['--setup', '--help'], cleanEnv);
  if (!helpOutput.includes('Setup Wizard') && !helpOutput.includes('Non-interactive mode')) {
    throw new Error(`--setup --help did not show setup wizard help:\n${helpOutput}`);
  }

  logStep(`Running installed binary --setup deployment smoke with timeout ${setupTimeoutMs}ms`);
  runInstalledBin(binPath, [
    '--setup',
    '--non-interactive',
    '--root',
    deployRoot,
    '--target',
    'vscode',
    '--no-preview',
    '--write',
  ], cleanEnv, setupTimeoutMs);

  const deployedServer = path.join(deployRoot, 'dist', 'server', 'index-server.js');
  const vscodeConfig = path.join(deployRoot, '.vscode', 'mcp.json');
  if (!fs.existsSync(deployedServer)) {
    throw new Error(`Setup did not deploy runtime from installed package: ${deployedServer}`);
  }
  if (!fs.existsSync(vscodeConfig)) {
    throw new Error(`Setup did not write VS Code MCP config: ${vscodeConfig}`);
  }

  console.log('Clean install smoke passed.');
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
