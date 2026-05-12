import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs';
import path from 'path';
import { expect } from 'vitest';

export type McpTarget = 'vscode' | 'vscode-global' | 'copilot-cli' | 'claude';
export type { McpProfile } from '../../services/mcpConfig/flagCatalog';

export interface LaunchSpecOptions {
  format: McpTarget;
  root?: string;
}

export interface BootOptions {
  configPath: string;
  serverName: string;
  format: McpTarget;
  timeoutMs?: number;
}

interface ServerEntry {
  type?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export function parseJsoncObject(text: string): Record<string, unknown> {
  let output = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      output += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }

    output += char;
  }

  let withoutTrailingCommas = '';
  inString = false;
  escaped = false;
  for (let i = 0; i < output.length; i += 1) {
    const char = output[i];
    if (inString) {
      withoutTrailingCommas += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      withoutTrailingCommas += char;
      continue;
    }
    if (char === ',') {
      let j = i + 1;
      while (/\s/.test(output[j] ?? '')) j += 1;
      if (output[j] === '}' || output[j] === ']') continue;
    }
    withoutTrailingCommas += char;
  }

  const parsed = JSON.parse(withoutTrailingCommas) as unknown;
  expect(parsed).toBeTruthy();
  expect(typeof parsed).toBe('object');
  expect(Array.isArray(parsed)).toBe(false);
  return parsed as Record<string, unknown>;
}

export function readConfig(configPath: string, format: McpTarget): Record<string, unknown> {
  const text = fs.readFileSync(configPath, 'utf8');
  return format === 'vscode' || format === 'vscode-global'
    ? parseJsoncObject(text)
    : JSON.parse(text) as Record<string, unknown>;
}

export function getServerEntry(
  config: Record<string, unknown>,
  format: McpTarget,
  serverName = 'index-server',
): ServerEntry {
  const rootKey = format === 'vscode' || format === 'vscode-global' ? 'servers' : 'mcpServers';
  const servers = config[rootKey] as Record<string, ServerEntry> | undefined;
  expect(servers, `Missing ${rootKey}`).toBeTruthy();
  const entry = servers?.[serverName];
  expect(entry, `Missing server entry ${serverName}`).toBeTruthy();
  return entry ?? {};
}

export function assertConfigValid(configPath: string, format: McpTarget, serverName = 'index-server'): void {
  const config = readConfig(configPath, format);
  const entry = getServerEntry(config, format, serverName);
  expect(typeof entry.command).toBe('string');
  expect(Array.isArray(entry.args)).toBe(true);
  expect(entry.args?.length).toBeGreaterThan(0);
  if (format === 'vscode' || format === 'vscode-global') {
    expect(entry.type).toBe('stdio');
  }
  if (entry.env !== undefined) {
    expect(typeof entry.env).toBe('object');
    for (const key of Object.keys(entry.env)) {
      expect(key.startsWith('INDEX_SERVER_'), `Unexpected env key ${key}`).toBe(true);
    }
  }
}

export function assertLaunchSpec(entry: ServerEntry, options: LaunchSpecOptions): void {
  expect(entry.command, 'Missing command').toBeTruthy();
  expect(entry.args?.[0], 'Missing args[0]').toBeTruthy();

  if (entry.command !== 'node') {
    expect(path.isAbsolute(entry.command ?? ''), `Command must be node or absolute: ${entry.command}`).toBe(true);
    expect(fs.existsSync(entry.command ?? ''), `Command does not exist: ${entry.command}`).toBe(true);
  }

  const entryPoint = String(entry.args?.[0] ?? '');
  const resolvedEntryPoint = options.format === 'vscode'
    ? path.resolve(entry.cwd ?? options.root ?? process.cwd(), entryPoint)
    : entryPoint;

  expect(path.normalize(resolvedEntryPoint).endsWith(path.join('dist', 'server', 'index-server.js'))).toBe(true);
  expect(fs.existsSync(resolvedEntryPoint), `Entrypoint does not exist: ${resolvedEntryPoint}`).toBe(true);

  const cwd = entry.cwd ?? options.root;
  if (cwd) {
    expect(fs.existsSync(cwd), `cwd does not exist: ${cwd}`).toBe(true);
    const packageJson = path.join(cwd, 'package.json');
    if (fs.existsSync(packageJson)) {
      const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8')) as { name?: string };
      expect(pkg.name).toBe('@jagilber-org/index-server');
    }
  }

  if (options.format === 'vscode-global') {
    expect(path.isAbsolute(entry.cwd ?? ''), 'vscode-global cwd must be absolute').toBe(true);
    expect(path.isAbsolute(entryPoint), 'vscode-global args[0] must be absolute').toBe(true);
  }

  const env = entry.env ?? {};
  if (env.INDEX_SERVER_PROFILE === 'enhanced') {
    expect(env.INDEX_SERVER_DASHBOARD_TLS).toBe('1');
  }
  if (env.INDEX_SERVER_PROFILE === 'experimental') {
    expect(env.INDEX_SERVER_STORAGE_BACKEND).toBe('sqlite');
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  expect(isProcessAlive(pid), `MCP server child process ${pid} is still alive after transport close`).toBe(false);
}

export async function bootFromConfig(options: BootOptions): Promise<void> {
  const config = readConfig(options.configPath, options.format);
  const entry = getServerEntry(config, options.format, options.serverName);
  assertLaunchSpec(entry, { format: options.format });

  const stderr: string[] = [];
  const transport = new StdioClientTransport({
    command: entry.command ?? 'node',
    args: entry.args ?? [],
    cwd: entry.cwd,
    env: entry.env,
    stderr: 'pipe',
  });
  transport.stderr?.on('data', chunk => stderr.push(String(chunk)));

  const client = new Client(
    { name: 'issue-317-boot-test', version: '1.0.0' },
    { capabilities: {} },
  );

  const timeout = setTimeout(() => {
    void transport.close();
  }, options.timeoutMs ?? 15_000);

  try {
    await client.connect(transport);
    const pid = transport.pid;
    expect(pid, 'Stdio transport did not expose a child PID').toBeTruthy();
    const serverVersion = client.getServerVersion();
    expect(serverVersion?.name).toBe('index-server');
    const tools = await client.listTools();
    const names = tools.tools.map(tool => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      'index_search',
      'index_add',
      'index_dispatch',
      'index_remove',
    ]));

    const issueId = `issue-317-${Date.now()}`;
    await client.callTool({
      name: 'index_add',
      arguments: {
        entry: {
          id: issueId,
          title: 'Issue 317 boot test',
          body: 'Created from generated MCP config.',
          priority: 50,
          audience: 'all',
          requirement: 'optional',
          categories: ['issue-317'],
        },
        lax: true,
      },
    });
    const search = await client.callTool({
      name: 'index_search',
      arguments: { keywords: [issueId], mode: 'keyword', limit: 5 },
    });
    expect(JSON.stringify(search)).toContain(issueId);
    await client.callTool({ name: 'index_remove', arguments: { ids: [issueId], missingOk: true } });
    const removedSearch = await client.callTool({
      name: 'index_search',
      arguments: { keywords: [issueId], mode: 'keyword', limit: 5 },
    });
    expect(JSON.stringify(removedSearch)).not.toContain(issueId);
    const health = await client.callTool({ name: 'health_check', arguments: {} });
    expect(JSON.stringify(health)).toContain('ok');
  } finally {
    const pid = transport.pid;
    clearTimeout(timeout);
    await client.close();
    await transport.close();
    if (pid) await waitForProcessExit(pid);
  }

  expect(stderr.join('\n')).not.toMatch(/\b(ERROR|FATAL)\b/);
}
