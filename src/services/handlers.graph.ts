// Instruction Graph Export Handler
// Phase 1 minimal deterministic implementation to satisfy graphExport.spec.ts.
// Provides a structural graph representation of the current instruction index with:
//  - Deterministic node ordering (alphabetical by id)
//  - Two edge types: 'primary' (instruction -> primaryCategory) and 'category' (pairwise co-category)
//  - Optional exclusion of primary edges via env GRAPH_INCLUDE_PRIMARY_EDGES=0
//  - Large category pairwise edge skip with note when size exceeds GRAPH_LARGE_CATEGORY_CAP (default: no cap)
//  - includeEdgeTypes filter (applied before truncation)
//  - maxEdges truncation (stable ordering then slice)
//  - format:'dot' emits Graphviz DOT output (undirected graph)
//  - Shallow caching for default parameter calls (returns identical object reference until index hash changes)
//  - meta: { graphSchemaVersion:1, nodeCount, edgeCount, truncated?, notes?[] }
// NOTE: This is intentionally dependency-light; future phases can enrich node/edge metadata.

import { registerHandler } from '../server/registry';
import { ensureLoaded, computeGovernanceHash } from './indexContext';
import type { InstructionEntry } from '../models/instruction';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { logError } from './logger.js';

type GraphConfigSnapshot = ReturnType<typeof getRuntimeConfig>['graph'];

export interface GraphExportParams {
  includeEdgeTypes?: Array<'primary'|'category'|'belongs'>;
  maxEdges?: number;
  format?: 'json'|'dot'|'mermaid'; // new: mermaid format
  // Phase 2 enrichment (opt-in, backward compatible)
  enrich?: boolean;                // enables enriched node/edge metadata + schema v2
  includeCategoryNodes?: boolean;  // materialize explicit category:* nodes
  includeUsage?: boolean;          // attach usageCount (real when available)
}

// Legacy (schema v1) node minimal shape
interface GraphNodeV1 { id: string; }
// Enriched (schema v2) node shape (superset)
interface GraphNodeV2 extends GraphNodeV1 {
  categories?: string[];
  primaryCategory?: string;
  priority?: number;
  priorityTier?: string;
  requirement?: string;
  owner?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  usageCount?: number; // present only when includeUsage requested
  nodeType?: 'instruction'|'category';
}
type GraphNode = GraphNodeV1 | GraphNodeV2;

interface GraphEdgeBase { from: string; to: string; type: 'primary'|'category'|'belongs'; }
interface GraphEdgeEnriched extends GraphEdgeBase { weight?: number; }
type GraphEdge = GraphEdgeBase | GraphEdgeEnriched;
// Allow schema version 1 (legacy minimal) or 2 (enriched) explicitly.
interface GraphMeta { graphSchemaVersion: 1|2; nodeCount: number; edgeCount: number; truncated?: boolean; notes?: string[] }
interface GraphResult { meta: GraphMeta; nodes: GraphNode[]; edges: GraphEdge[]; dot?: string; mermaid?: string }

// NOTE: For enriched responses we bump schema version to 2 (only when enrich=true)
const GRAPH_SCHEMA_VERSION_V1 = 1 as const;
const GRAPH_SCHEMA_VERSION_V2 = 2 as const;

// Cache now also considers environment-dependent knobs so toggling env vars between tests
// (e.g. disabling primary edges or applying a large category cap) does not incorrectly
// reuse a prior result built under different environmental semantics.
// We keep a small cache map for default param invocations (no format/includeEdgeTypes/maxEdges) keyed by envSig.
// Each entry invalidated when governance hash changes. Explicit env overrides still bypass caching (determinism focus).
const cachedDefaults: Map<string, { hash: string; result: GraphResult }> = new Map(); // v1 only cache

// Exported for dashboard API usage
export function buildGraph(params: GraphExportParams, graphCfg: GraphConfigSnapshot = getRuntimeConfig().graph): GraphResult {
  const { includeEdgeTypes, maxEdges, format, enrich, includeCategoryNodes, includeUsage } = params;
  const st = ensureLoaded();
  const instructions = [...st.list].sort((a,b)=> a.id.localeCompare(b.id));
  const enriched = !!enrich;
  // Build base instruction nodes (schema-dependent)
  const nodes: GraphNode[] = instructions.map(i=> {
    if(!enriched){ return { id: i.id }; }
    const inst = i as InstructionEntry & {
      priorityTier?: string; status?: string; owner?: string; createdAt?: string; updatedAt?: string; requirement?: string;
    };
    const n: GraphNodeV2 = {
      id: i.id,
      nodeType: 'instruction',
      categories: Array.isArray(i.categories)? [...i.categories] : [],
      primaryCategory: i.primaryCategory || i.categories?.[0],
      priority: typeof i.priority==='number'? i.priority: undefined,
      priorityTier: inst.priorityTier,
      requirement: inst.requirement,
      owner: inst.owner,
      status: inst.status,
      createdAt: inst.createdAt,
      updatedAt: inst.updatedAt,
    };
    if(includeUsage) {
      const usageVal = (i as InstructionEntry & { usageCount?: number }).usageCount;
      n.usageCount = usageVal != null ? usageVal : 0; // real value or 0 fallback
    }
    return n;
  });

  const includePrimary = graphCfg.includePrimaryEdges;
  const largeCap = graphCfg.largeCategoryCap;

  const edges: GraphEdge[] = [];
  const notes: string[] = [];

  // Primary edges (instruction -> pseudo-node named primaryCategory).
  // We do not currently add category nodes; tests only assert edge.type membership.
  if(includePrimary){
    for(const inst of instructions){
      const primary = inst.primaryCategory || inst.categories?.[0];
      if(primary){
        // In enriched+categoryNodes mode, primary edge points to category node id to unify references
        const toId = (enriched && includeCategoryNodes) ? `category:${primary}` : `${primary}`;
        const edge: GraphEdgeEnriched = { from: inst.id, to: toId, type:'primary' };
        if(enriched) edge.weight = 1;
        edges.push(edge);
      }
    }
  }

  // Category pairwise edges (instruction id pairs that share a category)
  // Build index of category -> instruction ids
  const catMap = new Map<string,string[]>();
  for(const inst of instructions){
    const cats = Array.isArray(inst.categories) ? inst.categories : [];
    for(const c of cats){
      const lc = c.toLowerCase();
      let arr = catMap.get(lc); if(!arr){ arr=[]; catMap.set(lc, arr); }
      arr.push(inst.id);
    }
  }
  const sortedCategories = [...catMap.keys()].sort((a,b)=> a.localeCompare(b));
  for(const cat of sortedCategories){
    const ids = catMap.get(cat)!; ids.sort((a,b)=> a.localeCompare(b));
    if(ids.length > largeCap){
      if(Number.isFinite(largeCap)){
        notes.push(`skipped pairwise for category '${cat}' size=${ids.length} cap=${largeCap}`);
      }
      continue;
    }
    // Pairwise category edges remain for backward compatibility even when category nodes materialized
    for(let i=0;i<ids.length;i++){
      for(let j=i+1;j<ids.length;j++){
        const edge: GraphEdgeEnriched = { from: ids[i], to: ids[j], type:'category' };
        if(enriched) edge.weight = 1;
        edges.push(edge);
      }
    }
  }

  // Optional category nodes & belongs edges (enriched mode only)
  if(enriched && includeCategoryNodes){
    const allCats = sortedCategories; // already sorted
    for(const cat of allCats){
      nodes.push({ id:`category:${cat}`, nodeType:'category' } as GraphNodeV2);
    }
    // belongs edges: instruction -> category node
    for(const inst of instructions){
      const cats = Array.isArray(inst.categories)? inst.categories: [];
      for(const c of cats){
        const edge: GraphEdgeEnriched = { from: inst.id, to: `category:${c}`, type:'belongs' };
        edge.weight = 1;
        edges.push(edge);
      }
    }
  }

  // Filter edge types before truncation
  let finalEdges = edges;
  if(includeEdgeTypes && includeEdgeTypes.length){
    const allowed = new Set(includeEdgeTypes);
    finalEdges = edges.filter(e=> allowed.has(e.type));
  }

  let truncated = false;
  if(typeof maxEdges === 'number' && maxEdges >= 0 && finalEdges.length > maxEdges){
    finalEdges = finalEdges.slice(0, maxEdges);
    truncated = true;
  }

  const meta: GraphMeta = { graphSchemaVersion: (enriched? GRAPH_SCHEMA_VERSION_V2: GRAPH_SCHEMA_VERSION_V1) as 1|2, nodeCount: nodes.length, edgeCount: finalEdges.length } as GraphMeta;
  if(truncated) meta.truncated = true;
  if(notes.length) meta.notes = notes;

  const result: GraphResult = { meta, nodes, edges: finalEdges };

  if(format === 'dot'){
    // Simple undirected DOT format representation. Include all nodes (instructions + optional category nodes)
    const lines: string[] = ['graph Instructions {'];
    for(const n of nodes){ lines.push(`  "${n.id}";`); }
    for(const e of finalEdges){ lines.push(`  "${e.from}" -- "${e.to}" [label="${e.type}"];`); }
    lines.push('}');
    result.dot = lines.join('\n');
  } else if(format === 'mermaid') {
    // Mermaid undirected graph (flowchart) representation.
    // We use a simple flowchart with -- links and edge type labels.
  // Mermaid v10+ requires a direction (TB/LR/RL/BT); previous placeholder 'undirected' caused syntax errors.
  // Using 'flowchart TB' (top-bottom) while edges use '---' (no arrow) to visually appear undirected.
  const lines: string[] = ['flowchart TB'];
    for(const n of nodes){
      // Escape minimal invalid chars (leave colon and hyphen intact)
      const safeId = n.id.replace(/[^A-Za-z0-9_:.-]/g,'_');
      lines.push(`${safeId}["${n.id}"]`);
    }
    for(const e of finalEdges){
      const fromSafe = e.from.replace(/[^A-Za-z0-9_:.-]/g,'_');
      const toSafe = e.to.replace(/[^A-Za-z0-9_:.-]/g,'_');
      lines.push(`${fromSafe} ---|${e.type}| ${toSafe}`);
    }
    const mermaidBody = lines.join('\n');
    // Provide standard YAML frontmatter with theme + layout + themeVariables so tests can assert presence
    // independent of client dashboard augmentation. Keep single themeVariables block.
    const fm = [
      '---',
      'config:',
      '  theme: base',
      '  layout: elk',
      '  themeVariables:',
      "    primaryColor: '#58a6ff'",
      "    primaryTextColor: '#f0f6fc'",
      "    primaryBorderColor: '#30363d'",
      "    lineColor: '#484f58'",
      "    secondaryColor: '#21262d'",
      "    tertiaryColor: '#161b22'",
      "    background: '#0d1117'",
      "    mainBkg: '#161b22'",
      "    secondBkg: '#21262d'",
      '---'
    ].join('\n');
    result.mermaid = fm + '\n' + mermaidBody;
  }

  return result;
}

registerHandler<GraphExportParams>('graph_export', (params) => {
  const p: GraphExportParams = params || {};
  const cacheEligible = !p.enrich && !p.format && !p.includeEdgeTypes && (p.maxEdges === undefined);
  // If either env knob is explicitly set we skip caching to avoid cross-test flakiness where
  // suites toggle values. Determinism > micro perf for explicit env usage.
  const graphCfg = getRuntimeConfig().graph;
  const envExplicit = graphCfg.explicitIncludePrimaryEnv || graphCfg.explicitLargeCategoryEnv;
  const st = ensureLoaded();
  const hash = st.hash || computeGovernanceHash(st.list);
  const envSig = graphCfg.signature;
  if(cacheEligible && !envExplicit){
    const entry = cachedDefaults.get(envSig);
    if(entry && entry.hash === hash){
      return entry.result;
    }
  }
  const graph = buildGraph(p, graphCfg);
  // Defensive: unexpected undefined safeguard (should never happen). Emit diagnostic once.
  if(!graph){
    logError('[graph_export] buildGraph returned undefined - returning empty graph (diagnostic)');
    return { meta:{ graphSchemaVersion:1, nodeCount:0, edgeCount:0 }, nodes:[], edges:[] } as GraphResult;
  }
  if(cacheEligible && !envExplicit){
    cachedDefaults.set(envSig, { hash, result: graph });
  }
  return graph;
});

// Test-only helper (not registered as a tool) to clear cached default between suites.
// Exported with a leading double underscore to discourage production usage.
export function __resetGraphCache(){ cachedDefaults.clear(); }
// Future phases: enrich node metadata (categories, priority, usage metrics), provenance, and export adapters.
