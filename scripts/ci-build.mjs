#!/usr/bin/env node
/**
 * CI-optimized build script
 * Handles both local development and CI environments
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const verbose = process.env.BUILD_VERBOSE === '1' || process.argv.includes('--verbose');
const NPX_BIN = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = isCI ? `::${level}::` : '';
  console.log(`${prefix}[${timestamp}] ${message}`);
}

function execNpx(args, options = {}) {
  if (verbose) log(`Executing: ${NPX_BIN} ${args.join(' ')}`, 'debug');

  try {
    const result = execFileSync(NPX_BIN, args, {
      stdio: verbose ? 'inherit' : 'pipe',
      encoding: 'utf8',
      ...options
    });
    return result;
  } catch (error) {
    log(`Command failed: ${NPX_BIN} ${args.join(' ')}`, 'error');
    log(`Error: ${error.message}`, 'error');
    if (error.stdout) log(`Stdout: ${error.stdout}`, 'error');
    if (error.stderr) log(`Stderr: ${error.stderr}`, 'error');
    throw error;
  }
}

function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0]);
  if (major < 20) {
    log(`Warning: Node.js ${version} detected. This project requires Node.js 20+`, 'warning');
  } else {
    log(`Using Node.js ${version}`, 'info');
  }
}

function cleanDist() {
  const distPath = path.join(process.cwd(), 'dist');
  const keepFile = path.join(process.cwd(), '.dist.keep');

  if (fs.existsSync(keepFile)) {
    log('Skipping dist clean (sentinel file present)', 'info');
    return;
  }

  log('Cleaning dist directory', 'info');
  fs.rmSync(distPath, { recursive: true, force: true });
}

function createDistSentinel() {
  const keepFile = path.join(process.cwd(), '.dist.keep');
  try {
    fs.writeFileSync(keepFile, 'persist dist between builds', { flag: 'wx' });
    log('Created dist sentinel file', 'debug');
  } catch (e) { if (e.code !== 'EEXIST') throw e; }
}

function verifyBuildArtifacts() {
  const serverEntry = path.join(process.cwd(), 'dist', 'server', 'index-server.js');
  const srcServerEntry = path.join(process.cwd(), 'dist', 'src', 'server', 'index-server.js');

  let serverExists = false;
  let srcServerExists = false;
  try { fs.accessSync(serverEntry); serverExists = true; } catch { /* missing */ }
  try { fs.accessSync(srcServerEntry); srcServerExists = true; } catch { /* missing */ }

  if (!serverExists && !srcServerExists) {
    throw new Error('Build verification failed: No server index-server.js found');
  }

  // Create compatibility shim if needed
  if (srcServerExists && !serverExists) {
    const distServerDir = path.dirname(serverEntry);
    fs.mkdirSync(distServerDir, { recursive: true });

    const shimContent = `// auto-generated compatibility shim
module.exports = require('../src/server/index-server.js');`;

    fs.writeFileSync(serverEntry, shimContent);
    log('Created compatibility shim: dist/server/index-server.js -> dist/src/server/index-server.js', 'info');
  }

  log('Build artifacts verified', 'info');
}

function main() {
  const startTime = Date.now();

  try {
    log('Starting CI-optimized build process', 'info');

    checkNodeVersion();

    // Clean dist if not in rapid development mode
    if (isCI || !fs.existsSync(path.join(process.cwd(), '.dist.keep'))) {
      cleanDist();
    }

    log('Running TypeScript compilation', 'info');
    execNpx(['tsc', '-p', 'tsconfig.json']);

    createDistSentinel();
    verifyBuildArtifacts();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`Build completed successfully in ${duration}s`, 'info');

    if (isCI) {
      // Output for GitHub Actions
      console.log('::set-output name=build-time::' + duration);
      console.log('::set-output name=build-status::success');
    }

  } catch (error) {
    log(`Build failed: ${error.message}`, 'error');

    if (isCI) {
      console.log('::set-output name=build-status::failure');
      console.log(`::error::Build failed: ${error.message}`);
    }

    process.exit(1);
  }
}

main();
