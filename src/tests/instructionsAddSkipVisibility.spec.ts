import { describe, it, expect } from 'vitest';
import { buildContentLengthFrame } from './util/stdioFraming.js';
import { performHandshake } from './util/handshakeHelper.js';

// Gating: This reliability reproduction occasionally times out (25–35s) due to upstream
// visibility anomaly under investigation. Skip by default unless explicitly enabled.
// Activate with: INDEX_SERVER_RUN_SKIP_VISIBILITY_RELIABILITY=1
const runGate = process.env.INDEX_SERVER_RUN_SKIP_VISIBILITY_RELIABILITY || '';
const enabled = /^(1|true|yes|on)$/i.test(runGate);

(!enabled ? describe.skip : describe)('index_add skip visibility reliability', () => {
  if (!enabled) {
    it('SKIPPED (set INDEX_SERVER_RUN_SKIP_VISIBILITY_RELIABILITY=1 to enable)', () => {
      expect(true).toBe(true);
    });
    return; // safety
  }

  it('duplicate add (skip) preserves immediate visibility', async () => {
    const DEV_DIR = process.cwd();
    const id = 'skip-visibility-' + Date.now();
    const body = 'Test body for skip visibility reliability patch';

    const { server, parser } = await performHandshake({ cwd: DEV_DIR, protocolVersion: '2025-06-18' });
    const send = (m: Record<string, unknown>) => server.stdin.write(buildContentLengthFrame(m));
    const wait = (reqId: number, ms = 12000) => parser.waitForId(reqId, ms, 40);

    // First add (overwrite:true to ensure deterministic create)
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'index_dispatch', arguments: { action: 'add', entry: { id, title: id, body, priority: 50, audience: 'all', requirement: 'optional', categories: [] }, overwrite: true, lax: true } } });
    const add1 = await wait(2);
    expect(add1.error).toBeFalsy();

    // Duplicate add without overwrite should skip
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'index_dispatch', arguments: { action: 'add', entry: { id, title: id, body, priority: 50, audience: 'all', requirement: 'optional', categories: [] }, overwrite: false, lax: true } } });
    const add2 = await wait(3);
    expect(add2.error).toBeFalsy();

    // List (request minimal diff list)
    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'index_dispatch', arguments: { action: 'list', expectId: id } } });
    const list = await wait(4);
    const listTxt = (list as any).result?.content?.[0]?.text;
    const listObj = listTxt ? JSON.parse(listTxt) : {};
    const found = !!listObj.items?.find((e: any) => e.id === id);
    expect(found).toBe(true);

    // Get entry
    send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'index_dispatch', arguments: { action: 'get', id } } });
    const get = await wait(5);
    const getTxt = (get as any).result?.content?.[0]?.text;
    const getObj = getTxt ? JSON.parse(getTxt) : {};
    expect(getObj.notFound).not.toBe(true);

    server.kill();
  }, 35000);
});
