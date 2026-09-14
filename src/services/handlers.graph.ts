// Instruction Graph Export Handler
// Phase 1 minimal deterministic implementation to satisfy graphExport.spec.ts.
// Provides a structural graph representation of the current instruction index with:
//  - Deterministic node ordering (alphabetical by id)
//  - Category-derived edges: 'primary' (instruction -> primaryCategory), 'category' (pairwise
//    co-category) and 'belongs' (instruction -> materialized category node, enriched mode only)
//  - 'link' edges materialized from each entry's structured `links` array (spec 511 REQ-16)
//  - Optional exclusion of primary edges via env GRAPH_INCLUDE_PRIMARY_EDGES=0
//  - Large category pairwise edge skip with note when size exceeds GRAPH_LARGE_CATEGORY_CAP (default: no cap)
//  - includeEdgeTypes filter (applied before truncation)
//  - maxEdges truncation (stable ordering then slice)
//  - format:'dot' emits Graphviz DOT output (undirected graph)
//  - Shallow caching for default parameter calls (returns identical object reference until the index reloads)
//  - meta: { graphSchemaVersion:1, nodeCount, edgeCount, truncated?, notes?[] }
// NOTE: This is intentionally dependency-light; future phases can enrich node/edge metadata.

import { registerHandler } from '../server/registry';
import { ensureLoaded, type IndexState } from './indexContext';
import { LINK_RELS, type InstructionEntry, type LinkRel } from '../models/instruction';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { logError } from './logger.js';

type GraphConfigSnapshot = ReturnType<typeof getRuntimeConfig>['graph'];

// ── Link edges (spec 511: REQ-13, REQ-16) ────────────────────────────────────
// The rel vocabulary comes from LINK_RELS in src/models/instruction.ts, which is
// parity-guarded against links.items.properties.rel.enum in the instruction schema.
// Imported rather than restated so there is exactly one source of truth (AR-1).
const LINK_REL_SET: ReadonlySet<string> = new Set<string>(LINK_RELS);
// REQ-1: `rel` is optional on stored links and defaults to 'related'.
const DEFAULT_LINK_REL: LinkRel = 'related';
// REQ-13: rels whose reverse direction is meaningful, so enriched mode materializes
// a derived edge B->A carrying `inverse: true`:
//   prerequisite  A requires B      -> B is required by A
//   sequel        A precedes B      -> B follows A
//   part-of       A is part of B    -> B contains A
//   related       symmetric         -> A<->B (both directions)
// 'see-also' is informational and non-binding, so it stays directed A->B only.
const REVERSIBLE_LINK_RELS: ReadonlySet<LinkRel> = new Set<LinkRel>(['prerequisite','sequel','part-of','related']);
// Bounded sample size for the dangling-target diagnostic note.
const DANGLING_LINK_SAMPLE = 5;

// Structural view of an entry's `links` element. Deliberately `unknown`-typed rather
// than reusing InstructionLink: graph export is a read path over records that may
// predate the schema bump or have been hand-edited on disk, so the declared types are
// not a runtime guarantee here and every field is validated before use.
interface RawInstructionLink { target?: unknown; rel?: unknown; label?: unknown }

export interface GraphExportParams {
  includeEdgeTypes?: Array<'primary'|'category'|'belongs'|'link'>;
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
  contentType?: string;
  createdAt?: string;
  updatedAt?: string;
  usageCount?: number; // present only when includeUsage requested (deprecated: = retrievedCount + appliedCount)
  retrievedCount?: number; // present only when includeUsage requested
  appliedCount?: number;   // present only when includeUsage requested
  nodeType?: 'instruction'|'category';
}
type GraphNode = GraphNodeV1 | GraphNodeV2;

interface GraphEdgeBase { from: string; to: string; type: 'primary'|'category'|'belongs'|'link'; }
interface GraphEdgeEnriched extends GraphEdgeBase {
  weight?: number;
  // Link-edge metadata (type==='link' only). `rel` and `label` mirror the stored
  // link; `inverse` marks an edge derived at query time rather than stored (REQ-13).
  rel?: LinkRel;
  label?: string;
  inverse?: boolean;
}
type GraphEdge = GraphEdgeBase | GraphEdgeEnriched;
// Allow schema version 1 (legacy minimal) or 2 (enriched) explicitly.
interface GraphMeta { graphSchemaVersion: 1|2; nodeCount: number; edgeCount: number; truncated?: boolean; notes?: string[] }
interface GraphResult { meta: GraphMeta; nodes: GraphNode[]; edges: GraphEdge[]; dot?: string; mermaid?: string }

// NOTE: For enriched responses we bump schema version to 2 (only when enrich=true)
const GRAPH_SCHEMA_VERSION_V1 = 1 as const;
const GRAPH_SCHEMA_VERSION_V2 = 2 as const;

// Cache for default-param invocations (no enrich/format/includeEdgeTypes/maxEdges),
// keyed first on the loaded index and then on the graph config signature so toggling
// env knobs between tests cannot reuse a result built under different semantics.
// Explicit env overrides still bypass caching entirely (determinism focus).
//
// Keyed on IndexState object identity rather than on st.hash. st.hash is a sha256 over
// `${id}:${sourceHash}` and sourceHash covers the entry BODY only — so edits to
// categories, primaryCategory or links leave it byte-identical and the old cache would
// happily serve a graph that no longer matched the index. ensureLoaded() returns the very
// same state object until an actual reload occurs, which makes identity both correct and
// O(1). A WeakMap lets a superseded state be collected along with its cached graphs.
let cachedDefaults = new WeakMap<IndexState, Map<string, GraphResult>>(); // v1 only cache

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
      contentType: i.contentType || 'instruction',
      createdAt: inst.createdAt,
      updatedAt: inst.updatedAt,
    };
    if(includeUsage) {
      const inst2 = i as InstructionEntry & { usageCount?: number; retrievedCount?: number; appliedCount?: number };
      const retrieved = inst2.retrievedCount != null ? inst2.retrievedCount : 0;
      const applied = inst2.appliedCount != null ? inst2.appliedCount : 0;
      n.retrievedCount = retrieved;
      n.appliedCount = applied;
      n.usageCount = inst2.usageCount != null ? inst2.usageCount : retrieved + applied; // real value or derived fallback
    }
    return n;
  });

  const includePrimary = graphCfg.includePrimaryEdges;
  const largeCap = graphCfg.largeCategoryCap;

  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const notes: string[] = [];

  function addEdge(edge: GraphEdge): void {
    let key: string;
    if(edge.type === 'category'){
      // Co-category edges are undirected: normalize endpoint order.
      key = `category:${[edge.from, edge.to].sort((a, b) => a.localeCompare(b)).join('--')}`;
    } else if(edge.type === 'link'){
      // Directed, and keyed by rel so A -see-also-> B and A -related-> B stay distinct.
      // `inverse` is deliberately NOT part of the key: when both A->B and B->A are
      // stored for a symmetric rel, the derived inverse collides with the stored edge
      // and the stored one wins (forward edges are emitted first). That keeps a
      // mutually-declared `related` pair at two edges instead of four.
      key = `link:${(edge as GraphEdgeEnriched).rel}:${edge.from}->${edge.to}`;
    } else {
      key = `${edge.type}:${edge.from}->${edge.to}`;
    }
    if(edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(edge);
  }

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
        addEdge(edge);
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
        addEdge(edge);
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
        addEdge(edge);
      }
    }
  }

  // Link edges (instruction -> instruction) from each entry's structured `links` array.
  // Appended last so the relative ordering of the pre-existing edge types — and therefore
  // the result of maxEdges truncation for callers that do not ask for link edges — is
  // unchanged by this feature.
  const instructionIds = new Set(instructions.map(i => i.id));
  const danglingTargets = new Set<string>();
  let skippedLinks = 0;
  // Normalized links per entry, collected in the forward pass and reused for the inverse
  // pass so validation runs once per stored link.
  const normalizedLinks: Array<{ from: string; to: string; rel: LinkRel; label?: string }> = [];

  for(const inst of instructions){
    // Widened to `unknown` on purpose — see RawInstructionLink.
    const rawLinks: unknown = inst.links;
    if(!Array.isArray(rawLinks)) continue;
    for(const raw of rawLinks){
      if(!raw || typeof raw !== 'object'){ skippedLinks++; continue; }
      const link = raw as RawInstructionLink;
      const target = typeof link.target === 'string' ? link.target.trim() : '';
      if(!target){ skippedLinks++; continue; }
      // Self-links are rejected at write time (REQ-9); drop defensively rather than
      // emitting a self-loop that most layout engines render as noise.
      if(target === inst.id){ skippedLinks++; continue; }
      let rel: LinkRel;
      if(link.rel === undefined || link.rel === null){
        rel = DEFAULT_LINK_REL;
      } else if(typeof link.rel === 'string' && LINK_REL_SET.has(link.rel)){
        rel = link.rel as LinkRel;
      } else {
        // Unrecognized rel: directionality semantics are unknown, so we cannot decide
        // whether to invert it. Skip and account for it in the notes.
        skippedLinks++;
        continue;
      }
      const label = typeof link.label === 'string' && link.label.trim() ? link.label : undefined;
      // Dead links are a write-time warning, not a rejection (REQ-10), so the edge is
      // still emitted — targets may be added out of order or live in another workspace.
      if(!instructionIds.has(target)) danglingTargets.add(target);
      normalizedLinks.push({ from: inst.id, to: target, rel, label });
    }
  }

  for(const link of normalizedLinks){
    const edge: GraphEdgeEnriched = { from: link.from, to: link.to, type: 'link', rel: link.rel };
    if(link.label !== undefined) edge.label = link.label;
    if(enriched) edge.weight = 1;
    addEdge(edge);
  }

  // Inverse edges are derived, not stored, so they are enriched-mode only (REQ-16).
  // Emitted in a second pass so a stored edge always wins the dedup against a derived
  // duplicate running the same direction.
  if(enriched){
    for(const link of normalizedLinks){
      if(!REVERSIBLE_LINK_RELS.has(link.rel)) continue;
      const edge: GraphEdgeEnriched = { from: link.to, to: link.from, type: 'link', rel: link.rel, inverse: true, weight: 1 };
      if(link.label !== undefined) edge.label = link.label;
      addEdge(edge);
    }
  }

  if(skippedLinks > 0){
    notes.push(`skipped ${skippedLinks} malformed link entr${skippedLinks === 1 ? 'y' : 'ies'} (missing target, self-reference, or unrecognized rel)`);
  }
  if(danglingTargets.size > 0){
    const sample = [...danglingTargets].sort((a,b)=> a.localeCompare(b)).slice(0, DANGLING_LINK_SAMPLE);
    const suffix = danglingTargets.size > sample.length ? ', ...' : '';
    notes.push(`link edges reference ${danglingTargets.size} target id(s) not present in the index: ${sample.join(', ')}${suffix}`);
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

  // Label used in the DOT / mermaid renderings. Link edges qualify the type with their
  // rel so the two textual formats do not collapse every relationship into one word.
  // The caller-supplied `label` is intentionally NOT rendered here: it is free text and
  // would need per-format escaping to be injection-safe. Consumers that want it read
  // the JSON edge list.
  function edgeLabel(e: GraphEdge): string {
    if(e.type !== 'link') return e.type;
    const le = e as GraphEdgeEnriched;
    return `link:${le.rel}${le.inverse ? ':inverse' : ''}`;
  }

  if(format === 'dot'){
    // Simple undirected DOT format representation. Include all nodes (instructions + optional category nodes)
    const lines: string[] = ['graph Instructions {'];
    for(const n of nodes){ lines.push(`  "${n.id}";`); }
    for(const e of finalEdges){ lines.push(`  "${e.from}" -- "${e.to}" [label="${edgeLabel(e)}"];`); }
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
      lines.push(`${fromSafe} ---|${edgeLabel(e)}| ${toSafe}`);
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
  const envSig = graphCfg.signature;
  if(cacheEligible && !envExplicit){
    const hit = cachedDefaults.get(st)?.get(envSig);
    if(hit) return hit;
  }
  const graph = buildGraph(p, graphCfg);
  // Defensive: unexpected undefined safeguard (should never happen). Emit diagnostic once.
  if(!graph){
    logError('[graph_export] buildGraph returned undefined - returning empty graph (diagnostic)');
    return { meta:{ graphSchemaVersion:1, nodeCount:0, edgeCount:0 }, nodes:[], edges:[] } as GraphResult;
  }
  if(cacheEligible && !envExplicit){
    let perEnv = cachedDefaults.get(st);
    if(!perEnv){ perEnv = new Map(); cachedDefaults.set(st, perEnv); }
    perEnv.set(envSig, graph);
  }
  return graph;
});

// Test-only helper (not registered as a tool) to clear cached default between suites.
// Exported with a leading double underscore to discourage production usage.
// A WeakMap has no clear(), so drop the whole map — superseded entries are collectable.
export function __resetGraphCache(){ cachedDefaults = new WeakMap(); }
// Future phases: enrich node metadata (categories, priority, usage metrics), provenance, and export adapters.
