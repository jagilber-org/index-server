import { describe, it, expect, afterAll } from 'vitest';
import { buildContentLengthFrame } from './util/stdioFraming.js';
import { performHandshake } from './util/handshakeHelper.js';
import fs from 'fs';
import path from 'path';

/*
  Visibility Invariant Tests
  Ensures: If index_dispatch add returns created:true, the entry MUST be immediately retrievable
  via action:get and discoverable via a query on its category or keyword without additional delay.
  This encodes the contractual guarantee we are hardening.
*/

describe('index_add visibility invariant', () => {
  const createdTestIds: string[] = [];
  const INDEX_SERVER_DIR = path.join(process.cwd(), 'instructions');

  // Cleanup: Remove all test artifacts created by this suite
  afterAll(() => {
    for (const testId of createdTestIds) {
      const filePath = path.join(INDEX_SERVER_DIR, `${testId}.json`);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        // Log but don't fail cleanup
        process.stderr.write(`[visibilityInvariant:cleanup] failed to remove ${testId}: ${err}\n`);
      }
    }
  });

  it('created:true implies immediate get success + category discoverability', async () => {
  // Use local workspace server (dist/server/index-server.js) to validate invariant deterministically.
  // Production deployment path introduced variable cold-start latency causing false negatives.
  const LOCAL_DIR = process.cwd();
    const TEST_ID = 'vis-' + Date.now();
    createdTestIds.push(TEST_ID); // Register for cleanup
    const CATEGORY = 'invariant';

    const { server, parser } = await performHandshake({
      cwd: LOCAL_DIR,
      protocolVersion: '2025-06-18',
      // Enable timing instrumentation so we can capture __timing phases for add/get path root cause analysis.
      extraEnv: { INDEX_SERVER_TEST_HANDSHAKE_MAX_MS: '25000', INDEX_SERVER_ADD_TIMING: '1' }
    });
    const sendCL = (m: Record<string, unknown>) => server.stdin.write(buildContentLengthFrame(m));
    const wait = (id: number, ms = 10000) => parser.waitForId(id, ms, 35);
    const init = parser.findById(1)!; // waited in helper
    expect(init.error,'init error').toBeFalsy();

    // Add instruction
    sendCL({ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'add', entry:{ id:TEST_ID, title:'Visibility Invariant', body:'Body for visibility invariant test', priority:5, audience:'all', requirement:'optional', categories:[CATEGORY] }, overwrite:true, lax:true }}});
    let add;
    try {
      add = await wait(2, 12000); // allow a bit longer for large index mutation
    } catch(firstErr){
      // One focused retry: resend add once if no frame received (handles rare race or lost frame)
      // eslint-disable-next-line no-console
      console.warn('[visibilityInvariant] retrying add after timeout:', (firstErr as Error).message);
      sendCL({ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'add', entry:{ id:TEST_ID, title:'Visibility Invariant', body:'Body for visibility invariant test', priority:5, audience:'all', requirement:'optional', categories:[CATEGORY] }, overwrite:true, lax:true }}});
      add = await wait(2, 12000);
    }
    expect(add.error,'add error').toBeFalsy();
    const addPayloadTxt = (add as any)?.result?.content?.[0]?.text as string | undefined;
    const addPayload = addPayloadTxt ? JSON.parse(addPayloadTxt) : {};
    try {
      // Write raw frame for diagnostic timing visibility if timing field missing
      const fs = await import('fs');
      const path = await import('path');
      const dir = path.join(process.cwd(),'tmp','visibility');
      fs.mkdirSync(dir,{recursive:true});
      fs.writeFileSync(path.join(dir, `add-frame-${TEST_ID}.json`), (add as any).raw || JSON.stringify(add,null,2),'utf8');
    } catch { /* ignore diagnostics */ }
    expect(addPayload.id,'add id echo').toBe(TEST_ID);
    expect(addPayload.created,'created flag').toBe(true);
    expect(addPayload.verified,'verified flag').toBe(true);

    // Immediate get MUST succeed
  sendCL({ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'get', id:TEST_ID }}});
  const get = await wait(3, 10000);
    expect(get.error,'get error').toBeFalsy();
    const getPayloadTxt = (get as any)?.result?.content?.[0]?.text as string | undefined;
    const getPayload = getPayloadTxt ? JSON.parse(getPayloadTxt) : {};
    expect(getPayload.item?.id,'get id mismatch').toBe(TEST_ID);

  // Immediate query discoverability (filter by category with generous limit to avoid pagination exclusion)
  sendCL({ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'query', text:undefined, categoriesAll:[], categoriesAny:[CATEGORY], limit:1000 }}});
  const query = await wait(4, 10000);
    expect(query.error,'query error').toBeFalsy();
    const queryTxt = (query as any)?.result?.content?.[0]?.text as string | undefined;
    const queryPayload = queryTxt ? JSON.parse(queryTxt) : {};
    const foundIds = Array.isArray(queryPayload.items) ? queryPayload.items.map((it:any)=>it.id) : [];
    expect(foundIds,'query should include id').toContain(TEST_ID);

    server.kill();
  }, 45000);
});
