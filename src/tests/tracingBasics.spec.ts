import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// NOTE: We import after setting env to ensure tracing module picks up flags.

function freshEnv(overrides: Record<string,string> = {}){
  const base: Record<string,string> = {
    INDEX_SERVER_TRACE_LEVEL: 'core',
    INDEX_SERVER_TRACE_PERSIST: '1',
    INDEX_SERVER_TRACE_DIR: path.join(process.cwd(),'logs','trace'),
    INDEX_SERVER_TRACE_SESSION: 'testsession',
    INDEX_SERVER_TRACE_CATEGORIES: 'ensureLoaded test'
  };
  for(const k of Object.keys(overrides)) base[k]=overrides[k];
  return base;
}

describe('Tracing Basics', () => {
  it('emits JSONL with session and category filtering', async () => {
    const dir = path.join(process.cwd(),'logs','trace');
    const before = fs.existsSync(dir)? new Set(fs.readdirSync(dir)) : new Set<string>();
    const env = freshEnv();
    Object.assign(process.env, env);
    const { emitTrace, summarizeTraceEnv } = await import('../services/tracing.js');

    // Should allow category 'test'
    emitTrace('[trace:test:unit]', { foo: 1 });
    // Should block category 'other'
    emitTrace('[trace:other]', { bar: 2 });

    const summary = summarizeTraceEnv();
    expect(summary.session).toBe('testsession');
    expect(summary.level).toBeGreaterThanOrEqual(1);

    // Flush microtasks & give FS a moment
    await new Promise(r=> setTimeout(r,50));

    const after = fs.existsSync(dir)? fs.readdirSync(dir).filter(f=> f.endsWith('.jsonl') && !before.has(f)) : [];
    expect(after.length).toBeGreaterThan(0);
    const file = path.join(dir, after[0]);
    const content = fs.readFileSync(file,'utf8').trim().split(/\n+/);
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
  });
});
