import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// NOTE: We import after setting env to ensure tracing module picks up flags.

function freshEnv(traceFile: string, overrides: Record<string,string> = {}){
  const base: Record<string,string> = {
    INDEX_SERVER_TRACE_LEVEL: 'core',
    INDEX_SERVER_TRACE_PERSIST: '1',
    INDEX_SERVER_TRACE_FILE: traceFile,
    INDEX_SERVER_TRACE_SESSION: 'testsession',
    INDEX_SERVER_TRACE_CATEGORIES: 'ensureLoaded test',
    INDEX_SERVER_TRACE_FSYNC: '1'
  };
  for(const k of Object.keys(overrides)) base[k]=overrides[k];
  return base;
}

async function waitForTraceContent(traceFile: string, timeoutMs = 2000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(traceFile)) {
      const content = fs.readFileSync(traceFile, 'utf8');
      if (content.includes('{')) return content;
    }
    await new Promise(r => setTimeout(r, 25));
  }
  return fs.existsSync(traceFile) ? fs.readFileSync(traceFile, 'utf8') : '';
}

describe('Tracing Basics', () => {
  it('emits JSONL with session and category filtering', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-server-tracing-basics-'));
    const traceFile = path.join(dir, 'trace.jsonl');
    const previousTraceEnv = new Map<string, string | undefined>();
    for (const key of Object.keys(process.env).filter(k => k.startsWith('INDEX_SERVER_TRACE_'))) {
      previousTraceEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    const env = freshEnv(traceFile);
    Object.assign(process.env, env);
    vi.resetModules();
    try {
      const { emitTrace, summarizeTraceEnv } = await import('../services/tracing.js');

      // Should allow category 'test'
      emitTrace('[trace:test:unit]', { foo: 1 });
      // Should block category 'other'
      emitTrace('[trace:other]', { bar: 2 });

      const summary = summarizeTraceEnv();
      expect(summary.session).toBe('testsession');
      expect(summary.level).toBeGreaterThanOrEqual(1);

      const content = (await waitForTraceContent(traceFile)).trim().split(/\n+/);
      // Lines are in the format: [label] {json}; extract the JSON segment starting at first '{'
      const recs = content.map(l=>{
        const brace = l.indexOf('{');
        if(brace === -1) return null;
        try { return JSON.parse(l.slice(brace)); } catch { return null; }
      });
      expect(recs.some(r=> r!==null)).toBe(true);
      const hasTest = recs.some(r=> r && r.label && String(r.label).includes('test:unit'));
      expect(hasTest).toBe(true);
      const hasOther = recs.some(r=> r && r.label && String(r.label).includes('[trace:other]'));
      expect(hasOther).toBe(false); // filtered out
    } finally {
      for (const key of Object.keys(process.env).filter(k => k.startsWith('INDEX_SERVER_TRACE_'))) {
        delete process.env[key];
      }
      for (const [key, value] of previousTraceEnv) {
        if (value !== undefined) process.env[key] = value;
      }
      vi.resetModules();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
