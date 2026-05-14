#!/usr/bin/env node
/**
 * Clean install smoke for the packed npm artifact.
 *
 * This intentionally installs the tarball into an empty npm prefix and runs the
 * generated binary shim from that prefix. It catches gaps that repo-checkout
 * tests miss, including missing package files and stale bin/setup paths.
 */
import { spawn, spawnSync } from 'node:child_process';
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

function parseJsonc(text) {
  const stripped = text
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped);
}

function buildFrame(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}\r\n`;
}

function extractToolNames(payload) {
  const tools = payload?.result?.tools ?? payload?.result?.capabilities?.tools;
  if (!Array.isArray(tools)) return [];
  if (tools.every(tool => typeof tool === 'string')) return tools;
  return tools
    .filter(tool => tool && typeof tool === 'object' && 'name' in tool)
    .map(tool => String(tool.name));
}

async function runGeneratedMcpToolsSmoke(configPath, env) {
  const config = parseJsonc(fs.readFileSync(configPath, 'utf8'));
  const server = config.servers?.['index-server'];
  if (!server) {
    throw new Error(`Generated VS Code config has no index-server entry: ${configPath}`);
  }
  if (!Array.isArray(server.args)) {
    throw new Error(`Generated VS Code config has invalid args: ${configPath}`);
  }

  const childEnv = {
    ...env,
    ...(server.env ?? {}),
    INDEX_SERVER_DASHBOARD: '0',
  };
  const command = server.command === 'node' ? process.execPath : server.command;
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  const child = spawn(command, server.args, {
    cwd: server.cwd,
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';
  const responses = new Map();
  const waiters = new Map();
  let buffer = '';

  function feed(chunk) {
    buffer += chunk.toString();
    while (true) {
      const headerIndex = buffer.indexOf('Content-Length:');
      if (headerIndex !== -1) {
        const crlfHeaderEnd = buffer.indexOf('\r\n\r\n', headerIndex);
        const lfHeaderEnd = buffer.indexOf('\n\n', headerIndex);
        let headerEnd = -1;
        let separatorLength = 0;
        if (crlfHeaderEnd !== -1 && (lfHeaderEnd === -1 || crlfHeaderEnd < lfHeaderEnd)) {
          headerEnd = crlfHeaderEnd;
          separatorLength = 4;
        } else if (lfHeaderEnd !== -1) {
          headerEnd = lfHeaderEnd;
          separatorLength = 2;
        }
        if (headerEnd !== -1) {
          const header = buffer.slice(headerIndex, headerEnd);
          const match = /^Content-Length:\s*(\d+)/im.exec(header);
          if (!match) {
            throw new Error(`MCP response missing Content-Length header: ${header}`);
          }
          const length = Number(match[1]);
          const bodyStart = headerEnd + separatorLength;
          const bodyEnd = bodyStart + length;
          if (buffer.length < bodyEnd) return;
          pushPayload(JSON.parse(buffer.slice(bodyStart, bodyEnd)));
          buffer = buffer.slice(bodyEnd);
          continue;
        }
      }

      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) return;
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.startsWith('{') && line.includes('jsonrpc')) {
        pushPayload(JSON.parse(line));
      }
    }
  }

  function pushPayload(payload) {
    if (payload.id !== undefined) {
      responses.set(payload.id, payload);
      const waiter = waiters.get(payload.id);
      if (waiter) {
        waiters.delete(payload.id);
        waiter(payload);
      }
    }
  }

  child.stdout.on('data', chunk => {
    stdout += chunk.toString();
    feed(chunk);
  });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  const waitForId = (id, timeoutMs) => new Promise((resolve, reject) => {
    if (responses.has(id)) {
      resolve(responses.get(id));
      return;
    }
    const timer = setTimeout(() => {
      waiters.delete(id);
      reject(new Error(`Timed out waiting for MCP response id=${id}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, timeoutMs);
    waiters.set(id, payload => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

  try {
    child.stdin.write(buildFrame({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        clientInfo: { name: 'clean-install-smoke', version: '1.0.0' },
      },
    }));
    const init = await waitForId(1, 20_000);
    if (init.error) {
      throw new Error(`MCP initialize failed: ${JSON.stringify(init.error)}`);
    }

    child.stdin.write(buildFrame({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }));
    child.stdin.write(buildFrame({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
    const list = await waitForId(2, 20_000);
    if (list.error) {
      throw new Error(`MCP tools/list failed: ${JSON.stringify(list.error)}`);
    }
    const toolNames = extractToolNames(list);
    if (!toolNames.includes('index_dispatch')) {
      throw new Error(`MCP tools/list did not include index_dispatch: ${JSON.stringify(list.result)}`);
    }
  } finally {
    child.kill();
  }
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
    '--scope',
    'repo',
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

  logStep('Starting generated repo-scope VS Code MCP config and checking tools/list');
  await runGeneratedMcpToolsSmoke(vscodeConfig, cleanEnv);

  logStep('Running installed binary --setup VS Code global config smoke');
  runInstalledBin(binPath, [
    '--setup',
    '--non-interactive',
    '--root',
    deployRoot,
    '--target',
    'vscode',
    '--scope',
    'global',
    '--no-deploy',
    '--no-preview',
    '--write',
  ], cleanEnv, setupTimeoutMs);

  const globalVscodeConfig = process.platform === 'win32'
    ? path.join(appDataDir, 'Code', 'User', 'mcp.json')
    : path.join(homeDir, '.config', 'Code', 'User', 'mcp.json');
  const ignoredGlobalSidecar = path.join(path.dirname(globalVscodeConfig), 'mcp.json.generated');
  if (!fs.existsSync(globalVscodeConfig)) {
    throw new Error(`Setup did not write VS Code global MCP config: ${globalVscodeConfig}`);
  }
  if (fs.existsSync(ignoredGlobalSidecar)) {
    throw new Error(`Setup wrote ignored VS Code sidecar instead of mcp.json: ${ignoredGlobalSidecar}`);
  }

  logStep('Starting generated global VS Code MCP config and checking tools/list');
  await runGeneratedMcpToolsSmoke(globalVscodeConfig, cleanEnv);

  console.log('Clean install smoke passed.');
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
