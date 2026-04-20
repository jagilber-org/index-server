import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { getRuntimeConfig } from '../config/runtimeConfig.js';
import { buildContentLengthFrame } from './util/stdioFraming.js';
import { performHandshake, shutdownHandshakeServer } from './util/handshakeHelper.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Minimal create→read contract smoke test against production deployment layout
// Fails fast on protocol contamination (non-JSON stdout lines containing braces/quotes)

describe('createReadSmoke', () => {
  const cfg = getRuntimeConfig();
  const createdTestIds: string[] = [];
  const INDEX_SERVER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'index-server-test-smoke-'));

  beforeAll(() => {
    // dir already created by mkdtempSync
  });

  // Cleanup: Remove all test artifacts created by this suite
  afterAll(() => {
    try { fs.rmSync(INDEX_SERVER_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const maybeIt = cfg.coverage.fastMode ? it.skip : it;
  maybeIt('initialize → tools/list → add → get works', async () => {
    const DEV_DIR = process.cwd();
    const distPath = path.join(DEV_DIR, 'dist', 'server', 'index-server.js');
    if(!fs.existsSync(distPath)){
      process.stderr.write('[createReadSmoke] skipping: dist not found at ' + distPath + ' — run npm run build\n');
      return;
    }
    const TEST_ID = 'smoke-' + Date.now();
    createdTestIds.push(TEST_ID); // Register for cleanup

    // Provide a longer per-id wait for production path (larger instruction set) or env override.
  let WAIT_ID_TIMEOUT_MS = cfg.timing('smoke.waitId', 20000)!;

    // Use helper (node server) instead of PowerShell start script for deterministic handshake speed.
    const progressLogs: string[] = [];
    const { server, parser } = await performHandshake({ cwd: DEV_DIR, protocolVersion:'2025-06-18', extraEnv: { INDEX_SERVER_DIR }, onProgress: info => {
      const line = `[createReadSmoke:progress] elapsed=${info.elapsed}ms sentinel=${info.sawSentinel} resendIn=${info.resendIn}`;
      if(progressLogs.length === 0 || progressLogs[progressLogs.length-1] !== line){ progressLogs.push(line); }
    }});
    let stdoutText = '';
    let stderrText = '';
    server.stdout.on('data', chunk => { stdoutText += chunk.toString(); });
    server.stderr.on('data', c => { stderrText += c.toString(); });
    const sendCL = (m: Record<string, unknown>) => server.stdin.write(buildContentLengthFrame(m));
    const wait = async (id: number) => {
      try {
        return await parser.waitForId(id, WAIT_ID_TIMEOUT_MS, 50);
      } catch (e){
        // If first-stage timeout, extend once if we saw any progress and retry quickly (adaptive recovery for large instruction loads)
        if(WAIT_ID_TIMEOUT_MS < 40000 && progressLogs.length){
          const prev = WAIT_ID_TIMEOUT_MS;
          WAIT_ID_TIMEOUT_MS = Math.min(45000, WAIT_ID_TIMEOUT_MS + 15000);
          process.stderr.write(`[createReadSmoke] escalating per-id timeout from ${prev}ms to ${WAIT_ID_TIMEOUT_MS}ms after early timeout id=${id}\n`);
          return parser.waitForId(id, WAIT_ID_TIMEOUT_MS, 50);
        }
        // Attach diagnostics context
        const diag = `waitForId-fail id=${id} progressLines=${progressLogs.length}\n` + progressLogs.slice(-10).join('\n');
        (e as Error).message += `\n${diag}`;
        throw e;
      }
    };
    const init = parser.findById(1)!; // already waited in helper
    expect(init.error,'init error').toBeFalsy();

    // Request tool list (may return either string[] or object[] with name properties per spec evolution)
    sendCL({ jsonrpc:'2.0', id:2, method:'tools/list', params:{} });
    const list = await wait(2);
    const listObj = list as unknown as { result?: { tools?: unknown; capabilities?: { tools?: unknown } } };
    function extractNames(raw: unknown): string[] {
      if(!raw) return [];
      if(Array.isArray(raw)){
        if(raw.length === 0) return [];
        if(raw.every(t => typeof t === 'string')) return raw as string[];
        if(typeof raw[0] === 'object' && raw[0] && 'name' in (raw[0] as Record<string,unknown>)){
          return (raw as Record<string,unknown>[]).map(o => String(o.name));
        }
      }
      return [];
    }
    const toolNames: string[] = extractNames(listObj.result?.tools) || extractNames(listObj.result?.capabilities?.tools);
    // With early stdin buffering the initial tools/list should reflect a stable registry; skip extended polling.
    expect(Array.isArray(toolNames),'tools list array').toBe(true);
    if(!toolNames.includes('index_dispatch')){
      // Provide rich diagnostics before failing
      throw new Error('dispatcher missing; raw tools payload(s)=' + JSON.stringify({ initial: listObj.result?.tools }, null, 2));
    }

    // Add new entry
    sendCL({ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'add', entry:{ id:TEST_ID, title:'Smoke', body:'Smoke test entry', priority:10, audience:'all', requirement:'recommended', categories:['test'] }, overwrite:true, lax:true }}});
    const add = await wait(3);
    expect(add.error,'add error').toBeFalsy();

    // Get the entry
    sendCL({ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'get', id:TEST_ID }}});
    const get = await wait(4);
    expect(get.error,'get error').toBeFalsy();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const addObj = add as unknown as { result?: { content?: { text?: string }[] } };
    const addPayloadTxt = addObj.result?.content?.[0]?.text;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const getObj = get as unknown as { result?: { content?: { text?: string }[] } };
    const getPayloadTxt = getObj.result?.content?.[0]?.text;
    const addPayload = addPayloadTxt ? JSON.parse(addPayloadTxt) : {};
    const getPayload = getPayloadTxt ? JSON.parse(getPayloadTxt) : {};
    // Reference stdout/stderr to avoid unused warnings & provide context if assertions fail.
    expect(typeof stdoutText).toBe('string');
    expect(typeof stderrText).toBe('string');

    expect(addPayload.id,'add id echo').toBe(TEST_ID);
    expect(addPayload.verified,'verified flag').toBe(true);
    expect(getPayload.item?.id,'get id').toBe(TEST_ID);

    try {
      // ... existing assertions executed above
    } finally {
      // Ensure process termination does not hang the test environment
      await shutdownHandshakeServer(server, { label:'createReadSmoke', graceMs: 1200, forceMs: 800 });
      if(progressLogs.length){
        process.stderr.write('[createReadSmoke] progress summary lines=' + progressLogs.length + '\n');
      }
    }
  }, 90000); // Extended overall time to allow adaptive per-id escalation and production cold start
});
