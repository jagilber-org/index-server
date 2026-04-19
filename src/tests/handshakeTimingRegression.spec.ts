import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { StdioFramingParser, buildContentLengthFrame } from './util/stdioFraming.js';
import path from 'path';

// Regression: ensure initialize responds within a reasonable bound now that
// early stdin buffering is implemented. This guards against reintroducing
// the lost-initialize bug (framesSeen=0 timeouts).
// Bound kept generous to avoid flakiness in CI; alerts when > 5s.

const SOFT_WARN_MS = 5000;
const HARD_FAIL_MS = parseInt(process.env.HANDSHAKE_HARD_FAIL_MS || '15000',10);

describe('handshake timing regression', () => {
  it('initialize responds promptly (no silent drop)', async () => {
    const dist = path.join(__dirname,'../../dist/server/index-server.js');
    const child = spawn(process.execPath, [dist], { stdio:['pipe','pipe','pipe'], env:{...process.env} });
    const parser = new StdioFramingParser();
    child.stdout.on('data', d=> parser.push(d.toString()));
    const t0 = Date.now();
    child.stdin.write(buildContentLengthFrame({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'handshake-timing', version:'1.0.0'}, capabilities:{ tools:{ listChanged:true } } } }));
    const frame = await parser.waitForId(1, HARD_FAIL_MS, 25);
    const elapsed = Date.now()-t0;
    // eslint-disable-next-line no-console
    console.log('[handshake-timing][elapsedMs]', elapsed);
    expect(frame.error,'initialize error').toBeFalsy();
    expect(elapsed).toBeLessThan(HARD_FAIL_MS);
    if(elapsed > SOFT_WARN_MS){
      // eslint-disable-next-line no-console
      console.warn('[handshake-timing][warning] initialize exceeded soft threshold', { elapsed });
    }
    child.kill();
  });
});
