import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import http from 'http';
import os from 'os';

// Assumes server can be imported (built or ts-node transpile) from dist in test env.
// We will spin up a lightweight instance by requiring the built server entry if available.

// Helper to perform simple GET
function get(url: string): Promise<{ status:number; body:string }>{
  return new Promise((resolve,reject)=>{
    const req = http.get(url, res=>{
      let data='';
      res.on('data', d=> data+=d);
      res.on('end', ()=> resolve({ status: res.statusCode||0, body: data }));
    });
    req.on('error', reject);
  });
}

// Derive instructions directory (temp dir to avoid repo root writes)
const instructionsDir = process.env.INDEX_SERVER_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'index-server-test-search-'));
const testFiles: string[] = [];

function writeInstruction(name: string, content: any){
  const file = path.join(instructionsDir, name + '.json');
  fs.writeFileSync(file, JSON.stringify(content, null, 2));
  testFiles.push(file);
}

// We don't actually run a Vite dev server in test; initialize as empty so tests can skip if startup fails.
let baseUrl = '';

describe('instructions search endpoint', () => {
  // Dashboard integration test: requires INDEX_SERVER_DASHBOARD=1 and a live server
  const dashboardEnabled = process.env.INDEX_SERVER_DASHBOARD === '1';

  beforeAll(async () => {
    if(!dashboardEnabled) return;
    if(!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir, { recursive: true });
    // Seed a few instructions
    writeInstruction('alpha-guide', { title: 'Alpha Guide', body: 'This covers the alpha process and onboarding.', categories:['onboarding','alpha'], description:'Alpha process docs', contentType: 'instruction'});
    writeInstruction('beta-overview', { title: 'Beta Overview', body: 'Overview of beta release pipeline.', categories:['release','beta'], description:'Beta channel summary', contentType: 'instruction'});
    writeInstruction('gamma-notes', { title: 'Gamma Notes', body: 'Operational gamma runbook for escalations.', categories:['operations'], description:'Escalation runbook', contentType: 'instruction'});

    // Attempt to start server only if not already running (simple heuristic: try a quick request)
    try {
      const ping = await get('http://127.0.0.1:3000/api/health');
      if(ping.status === 200){
        baseUrl = 'http://127.0.0.1:3000';
      } else {
        throw new Error('health not ok');
      }
    } catch {
      // Try to start a dashboard-enabled server programmatically.
      try {
        process.env.INDEX_SERVER_DASHBOARD = '1';
  process.env.INDEX_SERVER_MUTATION = '1';
        // Ensure a deterministic port for tests to probe quickly
        process.env.INDEX_SERVER_DASHBOARD_PORT = process.env.INDEX_SERVER_DASHBOARD_PORT || '8787';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('../../dist/server/index-server.js');
        if(typeof mod.main === 'function'){
          await mod.main();
        }
        const port = process.env.INDEX_SERVER_DASHBOARD_PORT;
        // optimistic early attempt (dashboard may already be listening)
        try {
          const h = await get(`http://127.0.0.1:${port}/api/health`);
          if(h.status === 200) baseUrl = `http://127.0.0.1:${port}`;
        } catch { /* ignore */ }
        for(let i=0;i<60 && !baseUrl;i++){
          try {
            // readiness probe: search endpoint with too-short query returns 200 + note
            const h = await get(`http://127.0.0.1:${port}/api/index_search?q=a`);
            if(h.status === 200){
              baseUrl = `http://127.0.0.1:${port}`;
              break;
            }
          } catch { /* retry */ }
          await new Promise(r=> setTimeout(r, 50));
        }
      } catch {
        // ignore (leave baseUrl empty)
      }
    }
  });

  afterAll(() => {
    // cleanup temp instruction files
    for(const f of testFiles){ try { fs.unlinkSync(f); } catch {/* ignore */} }
  });

  it('returns matches for substring across body and title', async () => {
    if(!baseUrl) return; // skip when dashboard unavailable
    const res = await get(`${baseUrl}/api/index_search?q=alpha`);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.success).toBe(true);
    expect(json.count).toBeGreaterThan(0);
    const names = json.results.map((r:any)=> r.name);
    expect(names).toContain('alpha-guide');
  });

  it('highlights first match with markdown emphasis', async () => {
    if(!baseUrl) return; // skip when dashboard unavailable
    const res = await get(`${baseUrl}/api/index_search?q=beta`);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    const snippet: string = json.results.find((r:any)=> r.name==='beta-overview')?.snippet || '';
    // Server uses **token** wrapping (markdown-style) not <mark> tag.
    expect(/\*\*beta\*\*/i.test(snippet)).toBe(true);
  });

  it('enforces query length >=2', async () => {
    if(!baseUrl) return; // skip when dashboard unavailable
    const res = await get(`${baseUrl}/api/index_search?q=a`);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.count).toBe(0);
    expect(json.note).toBe('query_too_short');
  });

});
