import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import { StdioFramingParser, buildContentLengthFrame } from './stdioFraming.js';

export interface HandshakeResult { server: ChildProcessWithoutNullStreams; parser: StdioFramingParser; initFrameId: number; }

/**
 * Gracefully shut down a spawned server process created by performHandshake.
 * Attempts:
 *  1. Send SIGTERM-equivalent (child.kill()) and wait up to graceMs.
 *  2. If still alive, send SIGKILL (on platforms that support it) and wait forceMs.
 *  3. If still not exited, resolves anyway (to avoid test hang) but logs diagnostic.
 */
export async function shutdownHandshakeServer(server: ChildProcessWithoutNullStreams, opts?: { graceMs?: number; forceMs?: number; label?: string }): Promise<{ exited: boolean; code: number | null; signal: NodeJS.Signals | null; forced: boolean }>{
  const graceMs = opts?.graceMs ?? 1500;
  const forceMs = opts?.forceMs ?? 1000;
  const label = opts?.label || 'handshakeServer';
  if(server.killed){
    return { exited: true, code: server.exitCode === null ? null : server.exitCode, signal: null, forced: false };
  }
  const waitForExit = (timeout: number) => new Promise<boolean>(resolve => {
    let done = false;
    const timer = setTimeout(() => { if(!done) resolve(false); }, timeout);
    server.once('exit', () => { if(!done){ done = true; clearTimeout(timer); resolve(true); } });
  });
  try { server.kill(); } catch {/* ignore */}
  let exited = await waitForExit(graceMs);
  let forced = false;
  if(!exited){
    forced = true;
    try { server.kill('SIGKILL'); } catch {/* ignore */}
    exited = await waitForExit(forceMs);
  }
  if(!exited){
    process.stderr.write(`[${label}] shutdown warning: process did not exit after ${(graceMs+forceMs)}ms (pid=${server.pid})\n`);
  }
  return { exited, code: server.exitCode === null ? null : server.exitCode, signal: null, forced };
}

/**
 * Minimal shared handshake routine:
 *  - Spawns server (node dist/server/index-server.js)
 *  - Waits for either stderr sentinel or first frame window before sending initialize (up to 1500ms)
 *  - Sends initialize (id=1) and waits (up to 10s default parser timeout)
 *  - If no frame within 4000ms after send, re-sends initialize once (id=1 idempotent per MCP spec)
 *  - Returns process + parser once initialize response observed.
 */
export async function performHandshake(opts?: { cwd?: string; protocolVersion?: string; extraEnv?: Record<string,string>; logDiagEveryMs?: number; onProgress?: (info:{ elapsed:number; sawSentinel:boolean; resendIn:number })=>void }): Promise<HandshakeResult> {
  let cwd = opts?.cwd || process.cwd();
  let dist = path.join(cwd, 'dist', 'server', 'index-server.js');
  // CI fallback: if provided cwd doesn't exist on this platform (e.g. Windows path on Linux runner),
  // fall back to current working directory so tests still exercise built server.
  const fs = await import('fs');
  if(!fs.existsSync(dist)){
    const candidate = path.join(process.cwd(), 'dist', 'server', 'index-server.js');
    if(fs.existsSync(candidate)){
      dist = candidate;
      cwd = process.cwd();
    }
  }
  // Consolidated mutation flag (legacy INDEX_SERVER_MUTATION retained elsewhere for backward compat warnings)
  const enableMutationEnv = { INDEX_SERVER_MUTATION: '1' };
  const server = spawn(process.execPath, [dist], { stdio: ['pipe','pipe','pipe'], env: { ...process.env, ...enableMutationEnv, ...(opts?.extraEnv||{}) } });
  const parser = new StdioFramingParser();
  let sawSentinel = false;
  server.stderr.on('data', d => { if(String(d).includes('SDK server started')) sawSentinel = true; });
  server.stdout.on('data', d => parser.push(String(d)));

  const sendInit = () => server.stdin.write(buildContentLengthFrame({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion: opts?.protocolVersion || '2025-06-18', capabilities:{ tools:{ listChanged:true } }, clientInfo:{ name:'handshake-helper', version:'1.0.0' } } }));

  // Allow environment overrides for diagnostics & timing (used in CI hardening)
  const baseMaxTotalMs = Number(process.env.INDEX_SERVER_TEST_HANDSHAKE_MAX_MS || 20000);
  // Allow adaptive extension (bounded) if we see clear progress (stderr sentinel) but initialization frame hasn't arrived yet.
  const adaptiveExtendMs = Number(process.env.INDEX_SERVER_TEST_HANDSHAKE_ADAPT_EXT_MS || 8000);
  const maxCapMs = baseMaxTotalMs + adaptiveExtendMs; // hard upper cap regardless of progress
  const preSentinelWaitMs = Number(process.env.INDEX_SERVER_TEST_HANDSHAKE_PRESENTINEL_MS || 1500);
  const resendGapMs = Number(process.env.INDEX_SERVER_TEST_HANDSHAKE_RESEND_AFTER_MS || 4000);
  const pollSleepMs = Number(process.env.INDEX_SERVER_TEST_HANDSHAKE_POLL_MS || 50);
  const diagEveryMs = opts?.logDiagEveryMs ?? Number(process.env.INDEX_SERVER_TEST_HANDSHAKE_DIAG_EVERY_MS || 2000);

  // Wait briefly (up to 1500ms) for sentinel to reduce chance of early frame loss.
  const start = Date.now();
  let dynamicDeadline = start + baseMaxTotalMs;
  while(!sawSentinel && Date.now() - start < preSentinelWaitMs){ await new Promise(r=>setTimeout(r,40)); }
  sendInit();
  // Fallback re-send once if no frames arrive within resendGapMs (initialize may have been dropped pre-listener).
  let initFrame: { id?: number } | undefined;
  const resendDeadline = Date.now()+resendGapMs;
  let lastDiag = start;
  while(!initFrame){
    initFrame = parser.findById(1);
    if(initFrame) break;
    if(Date.now()>resendDeadline){
      sendInit();
    }
    const now = Date.now();
    const elapsed = now-start;
    // If we have seen the sentinel and still within adaptive range, extend once up to cap.
    if(sawSentinel && dynamicDeadline < start + maxCapMs && (dynamicDeadline - now) < 250){
      dynamicDeadline = Math.min(start + maxCapMs, dynamicDeadline + 1000); // extend in 1s increments while progress
    }
    if(elapsed > dynamicDeadline){ // safety overall bound (possibly extended)
      throw new Error(`initialize timeout (helper) after ${elapsed}ms (baseMax=${baseMaxTotalMs} extendedCap=${maxCapMs}) cwd=${cwd} sawSentinel=${sawSentinel}`);
    }
    if(elapsed - lastDiag >= diagEveryMs){
      // Emit lightweight stderr diagnostics; avoids polluting stdout (reserved for protocol frames)
      // Include whether sentinel was seen to help differentiate pre-start vs post-start stalls.
      const resendIn = Math.max(0, resendDeadline-now);
      const remaining = dynamicDeadline - now;
      const msg = `[handshakeHelper] waiting init id=1 elapsed=${elapsed}ms remaining=${remaining}ms baseMax=${baseMaxTotalMs} cap=${maxCapMs} sawSentinel=${sawSentinel} resendIn=${resendIn}ms cwd=${cwd}`;
      process.stderr.write(msg + '\n');
      if(opts?.onProgress){
        try { opts.onProgress({ elapsed, sawSentinel, resendIn }); } catch {/* ignore progress errors */}
      }
      lastDiag = Date.now();
    }
    await new Promise(r=>setTimeout(r,pollSleepMs));
  }
  return { server, parser, initFrameId: 1 };
}
