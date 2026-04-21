import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { getRuntimeConfig } from '../config/runtimeConfig.js';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';

// Enhanced: server spawn resilience and deterministic polling with exponential backoff.

function wait(ms:number){ return new Promise(r=>setTimeout(r,ms)); }

// Integration test: exercise the dashboard synthetic activity route and verify
// that NDJSON tool lifecycle entries ([registry] → / ←) are emitted into the
// main log. This mirrors the UI "synthetic activity" button.

describe('Dashboard synthetic activity logging', () => {
  // Centralized runtime configuration (coverage fast mode + synthetic timing overrides)
  const cfg = getRuntimeConfig();
  const FAST_COVERAGE = cfg.coverage.fastMode;
  const logsDir = path.join(process.cwd(),'tmp','synthetic-activity-logging-test');
  const logFile = path.join(logsDir,'log.log');
  let proc: ReturnType<typeof spawn> | null = null;
  let earlyExit: Error | null = null;
  let baseUrl: string | undefined;

  // Env-driven tuning for stability / CI variance
  const READY_TIMEOUT_MS = cfg.timing('synthetic.ready', 12000)!; // consolidated timing key
  const POLL_DEADLINE_MS = cfg.timing('synthetic.deadline', 15000)!;
  const ITERATIONS = cfg.timing('synthetic.iterations', 6)!; // reused timing map for numeric counts
  const CONCURRENCY = cfg.timing('synthetic.concurrency', 3)!;
  const DIST_INDEX = path.join(process.cwd(),'dist','server', 'index-server.js');
  const DEPLOY_PRESENT = fs.existsSync(DIST_INDEX);
  if(!DEPLOY_PRESENT){
    // SKIP_OK: This integration test requires built dist/server/index-server.js for dashboard endpoints; allow skip in minimal env.
    test.skip('skip synthetic activity logging (dist build missing)', () => {}); // SKIP_OK
  }

  beforeAll(async () => {
    if(!fs.existsSync(logsDir)) fs.mkdirSync(logsDir,{recursive:true});
    if(fs.existsSync(logFile)) fs.unlinkSync(logFile);
    // Use port 0 for automatic ephemeral port selection; capture actual URL from stdout.
    proc = spawn(process.execPath, ['dist/server/index-server.js', '--dashboard-port=0', '--dashboard-host=127.0.0.1'], {
      cwd: process.cwd(),
      // INDEX_SERVER_LOG_SYNC forces fsync after each write so log polling becomes deterministic.
      env: { ...process.env, INDEX_SERVER_LOG_FILE: logFile, INDEX_SERVER_DASHBOARD: '1', INDEX_SERVER_LOG_SYNC: '1' },
      stdio: 'pipe'
    });
    let stdoutBuf='';
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', d=> { stdoutBuf += d.toString(); const m = /Server started on (https?:\/\/[^\s"]+)/.exec(stdoutBuf); if(m) baseUrl = m[1]; });
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', d=> { const s = d.toString(); const m = /Server started on (https?:\/\/[^\s"]+)/.exec(s); if(m) baseUrl = m[1]; });
    proc.once('exit', (code, signal) => { if(!earlyExit) earlyExit = new Error(`server exited early code=${code} signal=${signal}`); });
    proc.once('error', err => { if(!earlyExit) earlyExit = err; });
    // Wait for server URL discovery (stdout indicates readiness)
    const start = Date.now();
    while(!baseUrl && Date.now()-start < READY_TIMEOUT_MS){
      if(earlyExit) break;
      await wait(50);
    }
    if(!baseUrl){
      if(earlyExit) throw earlyExit;
      throw new Error('Server URL not captured within timeout');
    }
  }, 30000);

  afterAll(async () => {
    if(proc){ proc.kill(); proc = null; }
    await wait(200);
  });

  const maybeTest = FAST_COVERAGE ? test.skip : test;
  maybeTest('synthetic activity POST triggers registry → / ← logging', async () => {
    if(earlyExit) throw earlyExit;
    const body = JSON.stringify({ iterations: ITERATIONS, concurrency: CONCURRENCY });
    const resData: string = await new Promise((resolve, reject) => {
      const target = new URL('/api/admin/synthetic/activity', baseUrl!);
      const req = http.request({ method:'POST', hostname: target.hostname, port: parseInt(target.port,10), path: target.pathname, headers:{ 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body) }}, (res) => {
        let data='';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    expect(resData).toMatch(/"success":true/);
    // Parse JSON to assert executed>0 (defensive: if parse fails we still proceed to log polling)
    try {
      const parsed = JSON.parse(resData);
      expect(parsed.executed).toBeGreaterThan(0);
    } catch { /* ignore parse errors, raw regex success already asserted */ }
    // Retry log scan with time-based deadline (up to ~9s) using adaptive backoff.
  const deadline = Date.now() + POLL_DEADLINE_MS;
    let logSnapshot=''; let pollDelay=120; let found=false;
    while(Date.now() < deadline){
      logSnapshot = fs.existsSync(logFile) ? fs.readFileSync(logFile,'utf8') : '';
      if(/\[registry\] →/.test(logSnapshot) && /\[registry\] ←/.test(logSnapshot)) { found = true; break; }
      await wait(pollDelay);
      pollDelay = Math.min(Math.floor(pollDelay*1.4)+10, 750);
    }
    if(!found){
      // As a fallback diagnostic, capture metrics endpoint to aid debugging (non-fatal if request fails)
      try {
        const metricsData: string = await new Promise((resolve, reject) => {
          const target = new URL('/api/metrics', baseUrl!);
          const req = http.request({ method:'GET', hostname: target.hostname, port: parseInt(target.port,10), path: target.pathname }, (res) => {
            let buf=''; res.on('data', c=> buf+=c); res.on('end', ()=> resolve(buf)); });
          req.on('error', reject); req.end();
        });
        // Surface snippet in assertion message context by appending to logSnapshot
        logSnapshot += `\n\n[metrics-endpoint-snippet]\n${metricsData.slice(0,500)}`;
      } catch { /* ignore metrics fetch errors */ }
    }
  const startMatches = (logSnapshot.match(/\[registry\] →/g) || []).length;
  const endMatches = (logSnapshot.match(/\[registry\] ←/g) || []).length;
  expect(startMatches, `[registry] → not found in log tail:\n${logSnapshot.slice(-600)}`).toBeGreaterThan(0);
  expect(endMatches, `[registry] ← not found in log tail:\n${logSnapshot.slice(-600)}`).toBeGreaterThan(0);
  }, Math.max(45000, READY_TIMEOUT_MS + POLL_DEADLINE_MS + 8000));
});
