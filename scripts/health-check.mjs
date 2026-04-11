#!/usr/bin/env node
// Lightweight JSON-RPC health check for the MCP index server.
// Spawns the compiled server (dist/server/index-server.js), performs a proper
// initialize handshake followed by a health_check request, and validates
// that the response status === 'ok'. Writes the final health response to
// health_response.json (in CWD) for workflow inspection.
//
// Exit codes:
//  0 - success (status ok)
//  1 - initialization failed / no init response
//  2 - health check failed / status not ok
//  3 - timeout waiting for responses
//  4 - unexpected internal error
//
// Assumptions: `npm run build` already executed (dist artifacts present).

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const INIT_ID = 'init_1';
const HEALTH_ID = 'hc_1';
const TIMEOUT_MS = 120_000; // overall upper bound (2min for large Index with devinstructions)
const INIT_TIMEOUT_MS = 90_000; // init phase bound (1.5min for large Index loading)

/** Very small line-oriented JSON parser (server emits one JSON per line). */
function tryParse(line) {
  try { return JSON.parse(line); } catch { return undefined; }
}

function log(msg){ process.stderr.write(`[health-check] ${msg}\n`); }

async function main(){
  const startTs = Date.now();
  log('Starting server process for health check');
  const child = spawn(process.execPath, ['dist/server/index-server.js'], { stdio: ['pipe','pipe','pipe'] });
  let initDone = false;
  let healthDone = false;
  let initOk = false;
  let healthOk = false;
  let healthResponseObj = null;
  let stderrBuf = '';

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', d => { stderrBuf += d; });

  let stdoutBuf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    stdoutBuf += chunk;
    const lines = stdoutBuf.split(/\r?\n/);
    // keep last partial
    stdoutBuf = lines.pop();
    for(const line of lines){
      if(!line.trim()) continue;
      const msg = tryParse(line);
      if(!msg || msg.jsonrpc !== '2.0') continue;
      if(msg.id === INIT_ID){
        initDone = true;
        initOk = !!msg.result; // Any result indicates success
        if(!initOk) log(`Initialize returned error or empty result: ${line}`);
        // Immediately send health request once init completes
        if(initOk){
          sendHealth();
        }
      } else if(msg.id === HEALTH_ID){
        healthDone = true;
        healthResponseObj = msg;
        // For tools/call response, the actual health data is in result.content[0].text
        let actualStatus = null;
        if(msg.result && msg.result.content && msg.result.content[0] && msg.result.content[0].text){
          try {
            const healthData = JSON.parse(msg.result.content[0].text);
            actualStatus = healthData.status;
          } catch(e) {
            log(`Failed to parse health response JSON: ${e.message}`);
          }
        }
        healthOk = actualStatus === 'ok';
        if(!healthOk) log(`Health check failed: status = ${actualStatus}`);
        finish();
      }
    }
  });

  function sendInit(){
    const frame = {
      jsonrpc: '2.0',
      id: INIT_ID,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'health-check', version: '1.0.0' }
      }
    };
    child.stdin.write(JSON.stringify(frame) + '\n');
  }

  function sendHealth(){
    const frame = { jsonrpc: '2.0', id: HEALTH_ID, method: 'tools/call', params: { name: 'health_check', arguments: {} } };
    child.stdin.write(JSON.stringify(frame) + '\n');
  }

  function abort(code, reason){
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    log(`FAILED: ${reason}`);
    try { writeFileSync('health_response.json', JSON.stringify({ ok:false, reason, stderr: stderrBuf.slice(-4000) }, null, 2)); } catch { /* ignore */ }
    process.exit(code);
  }

  function finish(){
    if(!initOk){
      abort(1, 'Initialization failed or no init result');
      return;
    }
    if(!healthDone){
      // Wait for health
      return;
    }
    if(!healthOk){
      abort(2, 'Health status not ok');
      return;
    }
    const payload = { ok:true, response: healthResponseObj.result, stderrTail: stderrBuf.slice(-2000) };
    writeFileSync('health_response.json', JSON.stringify(payload, null, 2));
    log('Health check passed');
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    process.exit(0);
  }

  // Timeouts
  setTimeout(()=>{
    if(!initDone){
      abort(3, 'Timeout waiting for initialize response');
    } else if(!healthDone){
      abort(3, 'Timeout waiting for health response');
    }
  }, TIMEOUT_MS).unref();

  setTimeout(()=>{
    if(!initDone){
      abort(1, 'Initialize phase timeout');
    }
  }, INIT_TIMEOUT_MS).unref();

  child.on('error', e => abort(4, 'Spawn error: ' + e.message));
  child.on('exit', (code, signal) => {
    if(!healthDone){
      abort(4, `Server exited prematurely (code=${code} signal=${signal})`);
    }
  });

  sendInit();
}

main().catch(e => {
  process.stderr.write(`[health-check] Unhandled exception: ${e?.stack || e}\n`);
  process.exit(4);
});
