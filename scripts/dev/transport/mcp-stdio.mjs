/**
 * Minimal MCP stdio harness for dev tooling.
 *
 * Spawns dist/server/index-server.js with caller-supplied env, drives the
 * JSON-RPC handshake, exposes callTool(name, args) and close(). Mirrors the
 * working pattern in scripts/diagnostics/adhoc-mutation-integrity.mjs.
 *
 * Usage:
 *   import { startMcp } from './lib/mcp-stdio.mjs';
 *   const ctx = await startMcp({ env, distServer, onLine });
 *   const r = await ctx.callTool('index_search', { keywords: ['foo'] });
 *   await ctx.close();
 */
import { spawn } from 'node:child_process';

let nextMsgId = 1;

export async function startMcp({ env, distServer, cwd, onLine, initTimeoutMs = 8000 }) {
  const proc = spawn(process.execPath, [distServer], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: cwd || process.cwd(),
    env: { ...process.env, ...env },
  });
  const lines = [];
  let stdoutBuf = '';
  proc.stdout.on('data', (d) => {
    stdoutBuf += d.toString();
    let nl;
    while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, nl).replace(/\r$/, '');
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (line.length === 0) continue;
      lines.push(line);
      if (onLine) onLine('stdout', line);
    }
  });
  let stderrBuf = '';
  proc.stderr.on('data', (d) => {
    stderrBuf += d.toString();
    let nl;
    while ((nl = stderrBuf.indexOf('\n')) >= 0) {
      const line = stderrBuf.slice(0, nl).replace(/\r$/, '');
      stderrBuf = stderrBuf.slice(nl + 1);
      if (onLine) onLine('stderr', line);
    }
  });
  proc.on('error', (e) => { if (onLine) onLine('proc-error', String(e?.message || e)); });

  const ctx = { proc, lines };

  function send(method, params) {
    const id = nextMsgId++;
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return id;
  }

  function waitForId(id, timeout) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const iv = setInterval(() => {
        for (const l of lines) {
          try {
            const o = JSON.parse(l);
            if (o && o.id === id) { clearInterval(iv); return resolve(o); }
          } catch { /* non-JSON noise */ }
        }
        if (Date.now() - start > timeout) {
          clearInterval(iv);
          reject(new Error(`MCP timeout waiting for id=${id} (${timeout}ms)`));
        }
      }, 25);
    });
  }

  async function rpc(method, params, timeout = 8000) {
    const id = send(method, params);
    return waitForId(id, timeout);
  }

  ctx.callTool = (name, args, timeout) => rpc('tools/call', { name, arguments: args }, timeout ?? 12000);
  ctx.rpc = rpc;

  ctx.close = async () => {
    try { proc.stdin.end(); } catch { /* ignore */ }
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      proc.once('exit', finish);
      setTimeout(() => { try { proc.kill(); } catch { /* ignore */ } finish(); }, 1500);
    });
  };

  await rpc('initialize', {
    protocolVersion: '2025-06-18',
    clientInfo: { name: 'dev-server-cli', version: '1' },
    capabilities: { tools: {} },
  }, initTimeoutMs);

  return ctx;
}

export function parseToolPayload(resp) {
  const txt = resp?.result?.content?.[0]?.text;
  if (typeof txt !== 'string') return resp?.result;
  try { return JSON.parse(txt); } catch { return txt; }
}
