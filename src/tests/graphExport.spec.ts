import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import fs from 'fs';
import path from 'path';
import { reloadRuntimeConfig } from '../config/runtimeConfig';
import { callTool } from './testUtils';

function writeInstruction(id:string, body:string, categories:string[], primary?:string){
  const dir = process.env.INDEX_SERVER_DIR || path.join(process.cwd(),'instructions');
  if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  const now = new Date().toISOString();
  // Updated fixture to comply with current schema validation:
  //  - schemaVersion must be "4" (not "v4")
  //  - sourceHash must be a 64 hex sha256 style string
  //  - changeLog must contain at least one entry
  //  - categories already lower‑cased; provide primaryCategory alignment
  const rec = {
    id,
    title:id,
    body,
    rationale:'',
    priority:50,
    audience:'all',
    requirement:'optional',
    categories: categories.map(c=>c.toLowerCase()),
    primaryCategory: (primary && categories.includes(primary))? primary: categories[0],
    sourceHash: '0'.repeat(64),
    contentType: 'instruction',
    schemaVersion:'4',
    createdAt:now,
    updatedAt:now,
    version:'1.0.0',
    status:'approved',
    owner:'owner',
    priorityTier:'P3',
    classification:'public',
    lastReviewedAt:now,
    nextReviewDue:now,
    changeLog:[{ version:'1.0.0', changedAt: now, summary:'initial import' }],
    semanticSummary:''
  };
  fs.writeFileSync(path.join(dir, id+'.json'), JSON.stringify(rec,null,2));
}

describe('graph_export', () => {
  let dir:string;
  let invalidateFn: (()=>void)|null = null;
  beforeAll(async ()=>{
    // isolate instructions root for this suite BEFORE registering handlers to avoid loading large repo Index
    dir = path.join(process.cwd(),'tmp', `graph-test-${Date.now()}`);
    process.env.INDEX_SERVER_DIR = dir;
    reloadRuntimeConfig();
    // Dynamically import handlers AFTER env configured so initial ensureLoaded (if any) targets isolated dir
  await import('../services/handlers.graph.js');
  await import('../services/handlers.instructions.js');
    // Pull invalidate lazily
  const cat = await import('../services/indexContext.js');
    invalidateFn = cat.invalidate;
  });

  beforeEach(async () =>{
    // Clean directory between tests to keep scenarios independent
    if(fs.existsSync(dir)){
      for(const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir,f));
    } else {
      fs.mkdirSync(dir,{recursive:true});
    }
    delete process.env.INDEX_SERVER_GRAPH_INCLUDE_PRIMARY_EDGES;
    delete process.env.INDEX_SERVER_GRAPH_LARGE_CATEGORY_CAP;
    delete process.env.INDEX_SERVER_MUTATION;
    reloadRuntimeConfig();
    // seed default minimal index (a,b,c) unless a test wants a custom layout
    writeInstruction('a','body a',['alpha','shared'],'alpha');
    writeInstruction('b','body b',['beta','shared'],'beta');
    writeInstruction('c','body c',['beta'],'beta');
    // Force index invalidation so ensureLoaded observes fresh seed instead of reused prior large state
    invalidateFn?.();
    // Reset graph export cache (test-only helper) so previous env signature / hash combos don't leak
    try {
      const g = await import('../services/handlers.graph.js');
      if(typeof g.__resetGraphCache === 'function') g.__resetGraphCache();
    } catch { /* ignore */ }
  });

  it('returns deterministic structural graph JSON', async () => {
    const res = await callTool<any>('graph_export', {});
    // graphSchemaVersion lives under meta (Phase 1 schema contract)
    expect(res.meta.graphSchemaVersion).toBe(1);
    expect(Array.isArray(res.nodes)).toBe(true);
    expect(Array.isArray(res.edges)).toBe(true);
    // nodes sorted
    const ids = res.nodes.map((n:any)=>n.id);
    expect(ids).toEqual([...ids].sort());
    // edge type filtering defaults
    expect(res.edges.every((e:any)=> e.type==='primary' || e.type==='category')).toBe(true);
  });

  it('supports DOT output', async () => {
    const res = await callTool<any>('graph_export', { format:'dot' });
    expect(typeof res.dot).toBe('string');
    expect(res.dot.includes('graph Instructions')).toBe(true);
  });

  it('respects includeEdgeTypes filter', async () => {
    const res = await callTool<any>('graph_export', { includeEdgeTypes:['category'] });
    expect(res.edges.every((e:any)=> e.type==='category')).toBe(true);
  });

  it('applies maxEdges truncation', async () => {
    const res = await callTool<any>('graph_export', { maxEdges:0 });
    expect(res.meta.truncated).toBe(true);
    expect(res.edges.length).toBe(0);
  });

  it('can exclude primary edges via env var', async () => {
    process.env.INDEX_SERVER_GRAPH_INCLUDE_PRIMARY_EDGES = '0';
    reloadRuntimeConfig();
    const res = await callTool<any>('graph_export', {});
    // Expect only category edges
    expect(res.edges.length).toBeGreaterThan(0);
    expect(res.edges.every((e:any)=> e.type==='category')).toBe(true);
  });

  it('adds skip note when category exceeds cap', async () => {
    // Build a large category exceeding cap=2
    process.env.INDEX_SERVER_GRAPH_LARGE_CATEGORY_CAP = '2';
    // Disable primary edges so edge count expectation reflects category-only skip
    process.env.INDEX_SERVER_GRAPH_INCLUDE_PRIMARY_EDGES = '0';
    reloadRuntimeConfig();
    // overwrite default seed: create three instructions sharing bigcat
    // (beforeEach seeded a,b,c; clear & add three in one large category)
    const d = process.env.INDEX_SERVER_DIR!;
    for(const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d,f));
    writeInstruction('n1','b',['bigcat']);
    writeInstruction('n2','b',['bigcat']);
    writeInstruction('n3','b',['bigcat']);
    // Force index invalidation so graph handler does not reuse stale large edge set state
    invalidateFn?.();
    const res = await callTool<any>('graph_export', {});
    // No edges because pairwise skipped; note present
    expect(res.edges.length).toBe(0);
    expect(res.meta.notes?.some((n:string)=> n.includes("skipped pairwise for category 'bigcat'"))).toBe(true);
  });

  it('returns cached identical object on repeated call (reference stable)', async () => {
    const first = await callTool<any>('graph_export', {});
    const second = await callTool<any>('graph_export', {});
    // Shallow equality on stable properties
    expect(second.nodes).toEqual(first.nodes);
    expect(second.edges).toEqual(first.edges);
    // buildTs can differ if rebuilt, but calling twice without mutation should reuse cache => identical edge arrays by value
  });

  it('invalidates cache after index_add mutation', async () => {
    const before = await callTool<any>('graph_export', {});
    // Add new instruction which shares a category with existing to create at least one new edge
    const entry = { id:'z-new', title:'z-new', body:'z', priority:10, audience:'all', requirement:'optional', categories:['shared'], schemaVersion:'v3' };
    // Enable direct mutation for this test (avoids using dispatch abstraction)
    process.env.INDEX_SERVER_MUTATION = '1';
    reloadRuntimeConfig();
    await callTool<any>('index_add', { entry, overwrite:true, lax:true });
    const after = await callTool<any>('graph_export', {});
    // Node count increases
    expect(after.meta.nodeCount).toBe(before.meta.nodeCount + 1);
  });

  it('edge type filter applies before truncation enforcement deterministically', async () => {
    // Add more nodes to grow potential edges then request only category edges + low maxEdges
    writeInstruction('d1','b',['shared']);
    writeInstruction('d2','b',['shared']);
    writeInstruction('d3','b',['shared']);
    const filtered = await callTool<any>('graph_export', { includeEdgeTypes:['category'], maxEdges:2 });
    expect(filtered.edges.every((e:any)=> e.type==='category')).toBe(true);
    expect(filtered.edges.length).toBeLessThanOrEqual(2);
    if(filtered.meta.truncated){
      expect(filtered.edges.length).toBe(2);
    }
  });
});
