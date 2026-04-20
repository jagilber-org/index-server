import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { _parseArgs, _findPackageVersion, _startDashboard } from '../../server/index-server';
import fs from 'fs';
import path from 'path';
import { logInfo } from '../../services/logger';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';

// P1 coverage: exercise server helper exports and dashboard lifecycle

describe('server/index helper exports (P1)', () => {
  it('parseArgs parses dashboard flags', () => {
    const cfg = _parseArgs(['node','index','--dashboard','--dashboard-port=8999','--dashboard-host=127.0.0.1','--dashboard-tries=1']);
    expect(cfg.dashboard).toBe(true);
    expect(cfg.dashboardPort).toBe(8999);
    expect(cfg.dashboardHost).toBe('127.0.0.1');
    expect(cfg.maxPortTries).toBe(1);
  });

  it('parseArgs respects environment variables with CLI override', () => {
    // Save original env vars
    const originalDashboard = process.env.INDEX_SERVER_DASHBOARD;
    const originalPort = process.env.INDEX_SERVER_DASHBOARD_PORT;
    const originalHost = process.env.INDEX_SERVER_DASHBOARD_HOST;
    const originalTries = process.env.INDEX_SERVER_DASHBOARD_TRIES;

    try {
      // Set env vars
      process.env.INDEX_SERVER_DASHBOARD = '1';
      process.env.INDEX_SERVER_DASHBOARD_PORT = '9000';
      process.env.INDEX_SERVER_DASHBOARD_HOST = 'localhost';
      process.env.INDEX_SERVER_DASHBOARD_TRIES = '5';

      // Test env vars are applied
      const envCfg = _parseArgs(['node','index']);
      expect(envCfg.dashboard).toBe(true);
      expect(envCfg.dashboardPort).toBe(9000);
      expect(envCfg.dashboardHost).toBe('localhost');
      expect(envCfg.maxPortTries).toBe(5);

      // Test CLI overrides env vars
      const cliCfg = _parseArgs(['node','index','--no-dashboard','--dashboard-port=8888']);
      expect(cliCfg.dashboard).toBe(false);
      expect(cliCfg.dashboardPort).toBe(8888);
      expect(cliCfg.dashboardHost).toBe('localhost'); // still from env
      expect(cliCfg.maxPortTries).toBe(5); // still from env
    } finally {
      // Restore original env vars
      if (originalDashboard !== undefined) process.env.INDEX_SERVER_DASHBOARD = originalDashboard; else delete process.env.INDEX_SERVER_DASHBOARD;
      if (originalPort !== undefined) process.env.INDEX_SERVER_DASHBOARD_PORT = originalPort; else delete process.env.INDEX_SERVER_DASHBOARD_PORT;
      if (originalHost !== undefined) process.env.INDEX_SERVER_DASHBOARD_HOST = originalHost; else delete process.env.INDEX_SERVER_DASHBOARD_HOST;
      if (originalTries !== undefined) process.env.INDEX_SERVER_DASHBOARD_TRIES = originalTries; else delete process.env.INDEX_SERVER_DASHBOARD_TRIES;
    }
  });

  it('findPackageVersion returns semver-like string', () => {
    const v = _findPackageVersion();
    expect(v).toMatch(/\d+\.\d+\.\d+/);
  });

  it('startDashboard starts and serves /tools.json then closes', async () => {
  const dash = await _startDashboard({ dashboard:true, dashboardPort: 0, dashboardHost: '127.0.0.1', maxPortTries: 5, legacy:false, dashboardTls: false, dashboardTlsCert: '', dashboardTlsKey: '', dashboardTlsCa: '' });
    expect(dash).not.toBeNull();
    if(!dash) return; // type narrowing
    const url = dash.url.replace(/\/$/, '') + '/tools.json';
    // Use Node http to avoid fetch socket issues in constrained CI
    const attemptFetch = ()=> new Promise<any>((resolve, reject)=>{
      http.get(url, (res) => {
        let buf='';
        res.on('data',(c:Buffer)=>buf+=c.toString());
        res.on('end',()=>{ try { resolve(JSON.parse(buf)); } catch(e){ reject(e);} });
      }).on('error',reject);
    });
    let json: any; let lastErr: unknown;
    for(let i=0;i<3;i++){
      try { json = await attemptFetch(); break; } catch(e){ lastErr=e; await new Promise(r=>setTimeout(r,25)); }
    }
    if(!json && lastErr) throw lastErr;
    expect(json).toHaveProperty('tools');
    dash.close();
  });
});

describe('logger file logging (P1)', () => {
  const tmpDir = path.join(process.cwd(),'tmp','logger-p1');
  const logFile = path.join(tmpDir,'test.log');
  let origLogFile: string | undefined;
  beforeAll(()=>{
    origLogFile = process.env.INDEX_SERVER_LOG_FILE;
    fs.mkdirSync(tmpDir,{recursive:true});
    // Clean up any previous test log
    try { fs.unlinkSync(logFile); } catch { /* ignore */ }
    process.env.INDEX_SERVER_LOG_FILE = logFile;
    // Force runtimeConfig to re-read env vars so logger picks up the new path
    reloadRuntimeConfig();
  });
  afterAll(()=>{
    if (origLogFile !== undefined) process.env.INDEX_SERVER_LOG_FILE = origLogFile;
    else delete process.env.INDEX_SERVER_LOG_FILE;
    reloadRuntimeConfig();
  });
  it('writes log lines to file', async () => {
    logInfo('[test] p1_test', { sample: true });
    // wait for async stream flush
    await new Promise(r=>setTimeout(r,100));
    const content = fs.readFileSync(logFile,'utf8');
    expect(content).toMatch(/p1_test/);
  });
});
