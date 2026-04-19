/**
 * Unified stdio framing parser supporting both:
 *  1. MCP SDK style Content-Length: <n>\r?\n\r?\n<json>
 *  2. Legacy/newline-delimited raw JSON lines (used by isolation scripts)
 *
 * Provides a small state machine that accumulates chunks and extracts JSON objects.
 */
export interface ParsedFrame { id?: number; method?: string; result?: unknown; error?: unknown; raw: string; }

// Global defaults (overridable via env) to avoid scattering magic numbers across tests.
// Bump default wait timeout to tolerate slower cold starts while staying finite.
// Still overrideable via TEST_WAIT_ID_TIMEOUT_MS.
const DEFAULT_WAIT_ID_TIMEOUT_MS = (() => {
  const v = Number(process.env.TEST_WAIT_ID_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 10000; // was 6000
})();
const DEFAULT_WAIT_ID_POLL_MS = (() => {
  const v = Number(process.env.TEST_WAIT_ID_POLL_INTERVAL_MS);
  return Number.isFinite(v) && v > 0 ? v : 35;
})();

export class StdioFramingParser {
  private buffer = '';
  readonly frames: ParsedFrame[] = [];
  push(chunk: string | Buffer){
    this.buffer += chunk.toString('utf8');
    let progressed = true;
    while(progressed){
      progressed = false;
      // Try Content-Length first
      const headerIdx = this.buffer.indexOf('Content-Length:');
      if(headerIdx !== -1){
        const crlf2 = this.buffer.indexOf('\r\n\r\n', headerIdx);
        const lf2 = this.buffer.indexOf('\n\n', headerIdx);
        let sepIdx = -1; let sepLen = 0;
        if(crlf2 !== -1 && (lf2 === -1 || crlf2 < lf2)){ sepIdx = crlf2; sepLen = 4; }
        else if(lf2 !== -1){ sepIdx = lf2; sepLen = 2; }
        if(sepIdx !== -1){
          const headerBlock = this.buffer.slice(0, sepIdx + sepLen);
            const m = /Content-Length:\s*(\d+)/i.exec(headerBlock);
            if(m){
              const len = parseInt(m[1],10);
              const totalNeeded = sepIdx + sepLen + len;
              if(this.buffer.length >= totalNeeded){
                const jsonStr = this.buffer.slice(sepIdx + sepLen, totalNeeded);
                this.buffer = this.buffer.slice(totalNeeded);
                this.tryPush(jsonStr);
                progressed = true;
                continue; // loop
              }
            }
        }
      }
      // Fallback: newline JSON
      const nl = this.buffer.indexOf('\n');
      if(nl !== -1){
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl+1);
        if(line.startsWith('{') && line.includes('jsonrpc')){ this.tryPush(line); progressed = true; continue; }
      }
    }
  }
  private tryPush(jsonStr: string){
    try {
      const obj = JSON.parse(jsonStr);
      this.frames.push({ id: obj.id, method: obj.method, result: obj.result, error: obj.error, raw: jsonStr });
    } catch { /* ignore */ }
  }
  findById(id: number){ return this.frames.find(f=>f.id === id); }
  /** Return the last N characters of the internal buffer (for diagnostics). */
  bufferTail(n=800){ return this.buffer.length <= n ? this.buffer : this.buffer.slice(-n); }
  /**
   * Wait for a frame with a particular id to arrive.
   * Timeout & poll interval can be tuned via env vars:
   *  - TEST_WAIT_ID_TIMEOUT_MS
   *  - TEST_WAIT_ID_POLL_INTERVAL_MS
   */
  waitForId(id: number, timeoutMs=DEFAULT_WAIT_ID_TIMEOUT_MS, interval=DEFAULT_WAIT_ID_POLL_MS){
    return new Promise<ParsedFrame>((resolve, reject)=>{
      const start = Date.now();
      const poll = ()=>{
        const f = this.findById(id); if(f) return resolve(f);
        const elapsed = Date.now()-start;
        if(elapsed>timeoutMs){
          // Rich diagnostics: build structured error message & persist snapshot (best-effort).
          const framesSeen = this.frames.length;
          const diagnostic = {
            id,
            timeoutMs,
            elapsed,
            framesSeen,
            frameIds: this.frames.map(fr=>fr.id).slice(-25),
            bufferTail: this.bufferTail(2000),
            env: {
              TEST_WAIT_ID_TIMEOUT_MS: process.env.TEST_WAIT_ID_TIMEOUT_MS
            }
          };
          try {
            // Write once per timeout id for post-mortem (non-fatal if fails)
            // Using tmp/mcp-diag to keep repo root clean.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const fs = require('fs') as typeof import('fs');
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const path = require('path') as typeof import('path');
            const dir = path.join(process.cwd(), 'tmp', 'mcp-diag');
            fs.mkdirSync(dir, { recursive:true });
            fs.writeFileSync(path.join(dir, `waitForId-timeout-${id}-${Date.now()}.json`), JSON.stringify(diagnostic,null,2),'utf8');
          } catch { /* ignore */ }
          return reject(new Error('timeout id='+id+' elapsed='+elapsed+'ms framesSeen='+framesSeen));
        }
        setTimeout(poll, interval);
      }; poll();
    });
  }
}

export function buildContentLengthFrame(obj: unknown){
  const json = JSON.stringify(obj);
  return `Content-Length: ${Buffer.byteLength(json,'utf8')}\r\n\r\n${json}\r\n`;
}
