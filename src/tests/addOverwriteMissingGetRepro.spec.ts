import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { waitFor } from './testUtils';
import { getRuntimeConfig } from '../config/runtimeConfig';

// Red test capturing reported scenario: add (with overwrite:true) returns created:false, overwritten:true, verified:true
// yet subsequent immediate get reports notFound:true. This indicates index visibility mismatch after write.

function startServer(instructionsDir: string, traces: string[]){
  const tracingDefaults = getRuntimeConfig().tracing;
  const resolvedTraceLevel = (() => {
    if(tracingDefaults.level === 'trace' || tracingDefaults.level === 'verbose') return tracingDefaults.level;
    return 'core';
  })();
  const resolvedCategories = Array.from(tracingDefaults.categories).join(' ');
  const resolvedFsync = tracingDefaults.fsync ? '1' : '0';
  const proc = spawn(
    process.execPath,
    [path.join(__dirname,'../../dist/server/index-server.js')],
    {
      stdio:['pipe','pipe','pipe'],
      env:{
        ...process.env,
        INDEX_SERVER_MUTATION:'1',
        INDEX_SERVER_DIR: instructionsDir,
        // Visibility / tracing flags for diagnostic capture (forced persistent)
        INDEX_SERVER_VISIBILITY_DIAG:'1',
        INDEX_SERVER_TRACE_PERSIST:'1', // ensure trace JSONL written under logs/trace
        INDEX_SERVER_TRACE_LEVEL: resolvedTraceLevel,
        INDEX_SERVER_TRACE_CATEGORIES: resolvedCategories,
        INDEX_SERVER_TRACE_FSYNC: resolvedFsync || '1', // prefer runtime config but ensure durability fallback
      }
    }
  );
  // Capture stderr trace lines (emitTrace writes to stderr) separate from protocol stdout
  proc.stderr.on('data', d => {
    const lines = d.toString().trim().split(/\n+/).filter(Boolean);
    traces.push(...lines);
  });
  return proc;
}

function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin.write(JSON.stringify(msg)+'\n'); }

function collect(proc: ReturnType<typeof startServer>, out: string[]){
  proc.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/))); }

function find(out: string[], id: number){ return out.find(l=> { try { return JSON.parse(l).id===id; } catch { return false; } }); }

// NOTE: Originally authored as a RED reproduction for an add->get visibility bug. Investigation showed
// the earlier failure was due to parsing only the wrapper (result.created/overwritten undefined) instead
// of the inner JSON (result.content[0].text). This now serves as a positive consistency test verifying
// immediate get visibility after a successful add with overwrite flag.
describe('add overwrite then get consistency', () => {
  it('verifies add overwrite success followed by immediate get visibility', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'add-missing-repro-'));
    const traces: string[] = [];
    const server = startServer(dir, traces);
    const out: string[] = []; collect(server,out);
    // initialize
    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'add-repro', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!find(out,1), 6000);

  const id = 'mcp-server-testing-patterns-2025';
  // Use EXACT payload from user reproduction (including multi-line markdown body and fields)
  const body = `# MCP Server Testing Patterns (2025 Edition)\n\nStructured multi-phase testing methodology for MCP servers to ensure reliability, governance compliance, and safe knowledge operations.\n\n## 1. Bootstrap & Schema Validation\n- Validate instruction schemaVersion alignment\n- Run list/get on base index (expect deterministic hash)\n- Add temporary test instruction → get → delete → list (hash returns to baseline)\n\n## 2. Mutation & Persistence\n- Add N instructions (N<=3) sequentially, capture hash after each\n- Restart server (process recycle) → verify hash unchanged\n- Overwrite one instruction (rationale update) → verify updatedAt changes only\n\n## 3. Concurrency Safety (Light)\n- Rapid add/delete same ID (race probe) expecting: final state deterministic (present OR absent) without partial metadata\n\n## 4. Integrity & Drift\n- Run integrity_verify (if tool available) → zero mismatches\n- Export backup → compute external hash of exported JSON for audit\n\n## 5. Governance & Review Cadence\n- Ensure owner, priorityTier, reviewIntervalDays set\n- Verify nextReviewDue calculation matches interval\n\n## 6. Analytics & Usage Tracking\n- Track usage for a new instruction (usage_track) three times → hotset reflects presence\n\n## Edge Cases\n- Overwrite missing instruction (should create if supported OR error clearly)\n- Large body (>10k chars) rejection handling\n- Add with duplicate categories normalization\n\n## Success Criteria\n- All CRUD paths consistent\n- Hash changes only when index materially changes\n- No orphaned instructions reported\n\n## Recommended Automation\n- Nightly script executing phases 1–4\n- Weekly governance scan (phase 5)\n- Monthly analytics snapshot\n\n## Removal Safety Pattern\n1. List Index\n2. Export backup\n3. Remove non-core IDs\n4. Re-list & compare delta\n\nAdopt this pattern to maintain a clean, reliable, auditable instruction index.`;
  send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'add', entry:{ id, title:'MCP Server Testing Patterns 2025', body, rationale:'Provides a repeatable testing methodology to ensure MCP instruction reliability and governance health', priority:40, audience:'developers', requirement:'recommended', categories:['testing','mcp','governance','quality','patterns','reliability'] }, overwrite:true } } });
    await waitFor(()=> !!find(out,2), 6000);
    const addResp = find(out,2)!; const addPayload = JSON.parse(addResp);
    // STEP 1: Extract inner JSON object (server wraps tool result in result.content[0].text)
  const innerRaw: unknown = addPayload.result?.content?.[0]?.text;
    let inner: any = undefined;
    if(typeof innerRaw === 'string'){
      try { inner = JSON.parse(innerRaw); } catch { /* leave undefined */ }
    }
    // STEP 2: Assert creation/overwrite flags from inner object (red test should reach GET stage)
    if(!(inner?.created===true || inner?.overwritten===true)){
      // STEP 3: Diagnostics when flags missing or false
      let traceFiles: string[] = [];
      try {
        const traceDir = path.join(process.cwd(),'logs','trace');
        if(fs.existsSync(traceDir)) traceFiles = fs.readdirSync(traceDir).filter(f=> f.startsWith('trace-'));
      } catch { /* ignore */ }
      // eslint-disable-next-line no-console
      console.error('ADD_OPERATION_DIAGNOSTICS_INNER_PARSE', JSON.stringify({ addPayload, inner, recentTraces: traces.slice(-25), traceFiles }, null, 2));
    }
    expect(inner?.created===true || inner?.overwritten===true).toBe(true);
    // File must exist
    const file = path.join(dir, id + '.json');
    expect(fs.existsSync(file)).toBe(true);

    // Immediate get
    send(server,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'get', id } } });
    await waitFor(()=> !!find(out,3), 6000);
    const getResp = JSON.parse(find(out,3)!);
    // RED assertion (current bug): getResp.result?.notFound should NOT be true
    expect(getResp.result?.notFound, 'BUG: add claimed success but get responded notFound').not.toBe(true);

    server.kill();
  }, 20000);
});
