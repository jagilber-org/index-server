import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { spawn } from 'child_process';

// Asserts that invoking a tool writes NDJSON tool lifecycle log entries.
// The registry emits "[registry] → <tool>" on start and "[registry] ← <tool>" on end.

function wait(ms:number){ return new Promise(r=>setTimeout(r,ms)); }

describe('Tool logging integration', () => {
  // Use isolated log file (avoid cross-test interference with shared logs/mcp-server.log)
  const testLogDir = path.join(process.cwd(),'tmp','tool-logging-test');
  const logFile = path.join(testLogDir,'log.log');
  let proc: ReturnType<typeof spawn> | null = null;

  let stderrBuf = '';
  let stdoutBuf = '';

  beforeAll(async () => {
    if(!fs.existsSync(testLogDir)) fs.mkdirSync(testLogDir,{recursive:true});
    if(fs.existsSync(logFile)) fs.unlinkSync(logFile);
    // Start server (tool lifecycle logging now unconditional)
    proc = spawn(process.execPath, ['dist/server/index-server.js'], {
      cwd: process.cwd(),
      env: { ...process.env, INDEX_SERVER_LOG_FILE: logFile, INDEX_SERVER_DASHBOARD: '0', INDEX_SERVER_LOG_SYNC: '1' },
      stdio: 'pipe'
    });
  proc.stderr?.on('data', d => { stderrBuf += d.toString(); });
  proc.stdout?.on('data', d => { stdoutBuf += d.toString(); });
    // Allow startup
    const startWait = Date.now();
    while(Date.now()-startWait < 5000){
      if(/server_started/.test(stderrBuf)) break;
      await wait(50);
    }
  }, 10000);

  afterAll(async () => {
    if(proc){ proc.kill(); proc = null; }
    // Prevent unused var lint for captured stdout (could be used for future diagnostics)
    if(stdoutBuf.length < 0) console.log('');
    await wait(200);
  });

  test('invoking metrics_snapshot (via tools/call) emits registry → / ← in isolated log file', async () => {
    // Perform minimal initialize handshake first (protocol expects initialize before other calls)
    const initReq = JSON.stringify({ jsonrpc:'2.0', id:0, method:'initialize', params:{ protocolVersion:'2024-11-05', capabilities:{} } }) + '\n';
    proc?.stdin?.write(initReq);
    // Wait briefly for initialize processing
    await wait(400);
  // Invoke a guaranteed-registered stable tool with trivial execution
  const toolsReq = JSON.stringify({ jsonrpc:'2.0', id:1, method:'tools/call', params:{ name:'metrics_snapshot', arguments:{} } }) + '\n';
    proc?.stdin?.write(toolsReq);
    // Poll log file up to 3s for NDJSON registry lifecycle lines (allowing for lazy file init + write flush)
    let found = false;
    const deadline = Date.now() + 3000;
    while(Date.now() < deadline){
      const content = fs.existsSync(logFile) ? fs.readFileSync(logFile,'utf8') : '';
      if(/\[registry\] →/.test(content) && /\[registry\] ←/.test(content)){
        found = true; break;
      }
      await wait(120);
    }
    expect(found).toBe(true);
  }, 10000);
});
