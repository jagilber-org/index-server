import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { reloadRuntimeConfig } from '../config/runtimeConfig';
import { callTool } from './testUtils';

function writeInstruction(id:string, body:string, categories:string[], primary?:string, priority=50){
  const dir = process.env.INDEX_SERVER_DIR || path.join(process.cwd(),'instructions');
  if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  const now = new Date().toISOString();
  // schemaVersion must match instruction.schema.json enum ("4" not "v4"). Using invalid value caused loader rejection and empty Index.
  const rec = { id, title:id, body, rationale:'', priority, audience:'all', requirement:'optional', categories: categories.map(c=>c.toLowerCase()), primaryCategory: (primary && categories.includes(primary))? primary: categories[0],
    // Provide a valid 64-hex sourceHash (schema requires /^[a-f0-9]{64}$/)
    sourceHash: '0'.repeat(64),
    contentType: 'instruction',
    schemaVersion:'4', createdAt:now, updatedAt:now, version:'1.0.0', status:'approved', owner:'owner', priorityTier:'P3', classification:'public', lastReviewedAt:now, nextReviewDue:now,
    // changeLog must have at least one entry
    changeLog:[{ version:'1.0.0', changedAt: now, summary:'initial import' }], semanticSummary:'' };
  fs.writeFileSync(path.join(dir, id+'.json'), JSON.stringify(rec,null,2));
}

describe('graph_export enriched mode', () => {
  let dir:string; let invalidateFn: (()=>void)|null = null;
  beforeAll(async () => {
    dir = path.join(process.cwd(),'tmp', `graph-enriched-${Date.now()}`);
    process.env.INDEX_SERVER_DIR = dir;
    reloadRuntimeConfig();
    await import('../services/handlers.graph.js');
    await import('../services/handlers.instructions.js');
    const cat = await import('../services/indexContext.js');
    invalidateFn = cat.invalidate;
  });
  beforeEach(async () => {
    if(fs.existsSync(dir)){
      for(const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir,f));
    } else { fs.mkdirSync(dir,{recursive:true}); }
    delete process.env.INDEX_SERVER_GRAPH_INCLUDE_PRIMARY_EDGES;
    delete process.env.INDEX_SERVER_GRAPH_LARGE_CATEGORY_CAP;
  reloadRuntimeConfig();
    writeInstruction('a','body a',['alpha','shared'],'alpha',40);
    writeInstruction('b','body b',['beta','shared'],'beta',60);
    writeInstruction('c','body c',['beta'], 'beta',30);
    invalidateFn?.();
    try { const g = await import('../services/handlers.graph.js'); if(typeof g.__resetGraphCache==='function') g.__resetGraphCache(); } catch { /* ignore */ }
  });

  it('returns schema version 2 when enrich flag set', async () => {
    const res = await callTool<any>('graph_export', { enrich:true });
    expect(res.meta.graphSchemaVersion).toBe(2);
    expect(res.nodes.every((n:any)=> typeof n.id==='string')).toBe(true);
    // Enriched nodes should expose categories / primaryCategory
    const sample = res.nodes.find((n:any)=> n.id==='a');
    expect(sample.categories).toBeDefined();
    expect(sample.primaryCategory).toBeDefined();
  });

  it('materializes category nodes when includeCategoryNodes', async () => {
    const res = await callTool<any>('graph_export', { enrich:true, includeCategoryNodes:true });
    const catNodes = res.nodes.filter((n:any)=> n.nodeType==='category');
    expect(catNodes.length).toBeGreaterThan(0);
    // Expect belongs edges present
    expect(res.edges.some((e:any)=> e.type==='belongs')).toBe(true);
  });

  it('does not affect legacy v1 output when enrich omitted', async () => {
    const legacy = await callTool<any>('graph_export', {});
    expect(legacy.meta.graphSchemaVersion).toBe(1);
    // Should not have nodeType or categories fields on first node (minimal shape)
    const n = legacy.nodes[0];
    expect(n.nodeType).toBeUndefined();
    expect(n.categories).toBeUndefined();
  });

  it('supports includeEdgeTypes filtering including new belongs edge type', async () => {
    const res = await callTool<any>('graph_export', { enrich:true, includeCategoryNodes:true, includeEdgeTypes:['belongs'] });
    expect(res.edges.length).toBeGreaterThan(0);
    expect(res.edges.every((e:any)=> e.type==='belongs')).toBe(true);
  });

  it('includes usageCount placeholder when includeUsage', async () => {
    const res = await callTool<any>('graph_export', { enrich:true, includeUsage:true });
    const node = res.nodes.find((n:any)=> n.id==='a');
    expect(node.usageCount).toBe(0);
  });
});
