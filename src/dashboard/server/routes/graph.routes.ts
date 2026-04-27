/**
 * Graph Routes
 * Routes: GET /graph/mermaid, GET /graph/categories, GET /graph/instructions, GET /graph/relations
 */

import { Router, Request, Response } from 'express';
import { buildGraph, GraphExportParams } from '../../../services/handlers.graph.js';
import { getRuntimeConfig } from '../../../config/runtimeConfig.js';
import type { IndexLocals } from '../middleware/ensureLoadedMiddleware.js';
import { logDebug, logError, logWarn } from '../../../services/logger.js';

export function createGraphRoutes(): Router {
  const router = Router();

  /**
   * GET /api/graph/mermaid - Returns mermaid representation of the instruction graph.
   * Query params:
   *   enrich=1        -> include enriched schema (v2) data generation path
   *   categories=1    -> include explicit category nodes
   *   usage=1         -> include usageCount when available
   *   edgeTypes=a,b   -> restrict edge types (comma separated)
   */
  router.get('/graph/mermaid', (req: Request, res: Response) => {
    try {
      const { enrich, categories, usage, edgeTypes, selectedCategories, selectedIds } = req.query as Record<string, string | undefined>;
      const includeEdgeTypes = edgeTypes ? (edgeTypes.split(',').filter(Boolean) as GraphExportParams['includeEdgeTypes']) : undefined;
      const t0 = Date.now();
      try {
        logDebug('[graph/mermaid][start]', { enrich, categories, usage, edgeTypes: edgeTypes || '', selCats: selectedCategories || '', selIds: selectedIds || '' }); // lgtm[js/log-injection] — query params for debugging
      } catch { /* ignore diag logging errors */ }

      const graph = buildGraph({
        enrich: enrich === '1' || enrich === 'true',
        includeCategoryNodes: categories === '1' || categories === 'true',
        includeUsage: usage === '1' || usage === 'true',
        includeEdgeTypes,
        format: 'mermaid'
      });
      if (!graph.mermaid) {
        return res.status(500).json({ success: false, error: 'failed_to_generate_mermaid' });
      }

      let mermaidSource = graph.mermaid;
      const catFilter = selectedCategories?.split(',').filter(Boolean) || [];
      const idFilter = selectedIds?.split(',').filter(Boolean) || [];
      let filteredNodeCount: number | undefined; let filteredEdgeCount: number | undefined; let scoped = false; let keptIdsSize = 0;
      if ((catFilter.length || idFilter.length) && mermaidSource) {
        try {
          const keepIds = new Set<string>();
          for (const id of idFilter) keepIds.add(id);
          const wantCategoryNodes = (categories === '1' || categories === 'true');
          if (catFilter.length) {
            const catSet = new Set(catFilter.map(c => c.toLowerCase()));
            if (wantCategoryNodes) {
              for (const c of catFilter) { keepIds.add(`category:${c}`); }
            }
            if (graph.meta.graphSchemaVersion === 2) {
              type EnrichedNodeLike = { id: string; categories?: string[] };
              for (const nodeRaw of graph.nodes as EnrichedNodeLike[]) {
                const nodeCats = nodeRaw.categories;
                if (Array.isArray(nodeCats) && nodeCats.some(c => catSet.has(c.toLowerCase()))) {
                  keepIds.add(nodeRaw.id);
                  if (wantCategoryNodes) {
                    for (const c of nodeCats) { if (catSet.has(c.toLowerCase())) keepIds.add(`category:${c}`); }
                  }
                }
              }
            }
          }
          if (keepIds.size) {
            let frontmatterBlock = '';
            let remainder = mermaidSource;
            if (remainder.startsWith('---\n')) {
              const fmMatch = /^---\n[\s\S]*?\n---\n/.exec(remainder);
              if (fmMatch) {
                frontmatterBlock = fmMatch[0];
                remainder = remainder.slice(fmMatch[0].length);
              }
            }
            const lines = remainder.split(/\r?\n/);
            const directiveIdx = lines.findIndex(l => /^\s*(flowchart|graph)\b/i.test(l));
            let directiveLine = '';
            if (directiveIdx >= 0) {
              directiveLine = lines[directiveIdx];
            }
            const nodeIdPattern = Array.from(keepIds).map(id => id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
            const nodeRegex = new RegExp(`^(\\s*)(${nodeIdPattern})\\[`);
            const edgeRegex = new RegExp(`^(.*)(${nodeIdPattern})(.*)(${nodeIdPattern})(.*)$`);
            const filtered: string[] = [];
            const styleRegexes = [
              /^\s*classDef\s+/i,
              /^\s*style\s+[A-Za-z0-9:_-]+\s+/i,
              /^\s*class\s+[A-Za-z0-9:_-]+\s+/i,
              /^\s*linkStyle\s+\d+/i
            ];
            for (const ln of lines) {
              if (!ln) continue;
              if (directiveLine && ln === directiveLine) { continue; }
              const trimmed = ln.trim();
              if (trimmed.startsWith('%%')) { filtered.push(ln); continue; }
              if (styleRegexes.some(r => r.test(trimmed))) { filtered.push(ln); continue; }
              if (nodeRegex.test(ln) || edgeRegex.test(ln)) filtered.push(ln);
            }
            const parts: string[] = [];
            if (frontmatterBlock) parts.push(frontmatterBlock.trimEnd());
            if (directiveLine) parts.push(directiveLine);
            parts.push(...filtered);
            mermaidSource = parts.join('\n');
            if (getRuntimeConfig().logging.verbose) {
              logDebug('[graph/mermaid][filter:new]', { selectedIds: idFilter.length, selectedCategories: catFilter.length, kept: keepIds.size, totalLines: lines.length, emittedLines: parts.length });
            }
            keptIdsSize = keepIds.size; scoped = true;
            try {
              const nodeLineRegex = /^(\s*)([A-Za-z0-9:_-]+)\[[^\]]*\]/;
              const edgeLineRegex = /-->|===|~~>|\|-/;
              let n = 0, eCnt = 0; for (const ln of filtered) { if (nodeLineRegex.test(ln)) n++; else if (edgeLineRegex.test(ln)) eCnt++; }
              filteredNodeCount = n; filteredEdgeCount = eCnt;
            }
            catch { /* ignore count derivation errors */ }
          }
        } catch (filterErr) {
          logWarn('[graph/mermaid][filter-failed]', filterErr);
        }
      }
      try {
        logDebug('[graph/mermaid][ok]', { ms: Date.now() - t0, nodes: graph.meta?.nodeCount, edges: graph.meta?.edgeCount, bytes: mermaidSource.length });
      } catch { /* ignore diag logging errors */ }
      let metaOut: typeof graph.meta = graph.meta;
      if (scoped && graph.meta) {
        try {
          type GraphMetaType = typeof graph.meta;
          const base: GraphMetaType = { ...graph.meta } as GraphMetaType;
          const augmented = base as GraphMetaType & { scoped?: boolean; keptIds?: number };
          if (typeof filteredNodeCount === 'number') (augmented as { nodeCount: number }).nodeCount = filteredNodeCount;
          if (typeof filteredEdgeCount === 'number') (augmented as { edgeCount: number }).edgeCount = filteredEdgeCount;
          augmented.scoped = true;
          augmented.keptIds = keptIdsSize;
          metaOut = augmented;
        } catch { /* ignore meta cloning issues */ }
      }
      res.json({ success: true, meta: metaOut, mermaid: mermaidSource });
    } catch (err) {
      const e = err as Error;
      try {
        logWarn('[graph/mermaid][error]', e.message);
      } catch { /* ignore diag logging errors */ }
      res.status(500).json({ success: false, error: 'Failed to generate mermaid graph' });
    }
  });

  /**
   * GET /api/graph/categories
   * Returns list of unique categories with instruction counts.
   */
  router.get('/graph/categories', (_req: Request, res: Response) => {
    try {
      const st = (res.locals as IndexLocals).indexState;
      const map = new Map<string, number>();
      for (const inst of st.list) {
        const cats = Array.isArray(inst.categories) ? inst.categories : [];
        for (const c of cats) { map.set(c, (map.get(c) || 0) + 1); }
      }
      const categories = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, count]) => ({ id, count }));
      res.json({ success: true, categories, total: categories.length, timestamp: Date.now() });
    } catch (err) {
      logError('[graph/categories] Error:', err);
      res.status(500).json({ success: false, error: 'Failed to get categories' });
    }
  });

  /**
   * GET /api/graph/instructions?categories=a,b&limit=100
   * Returns lightweight instruction list filtered by categories (OR semantics).
   */
  router.get('/graph/instructions', (req: Request, res: Response) => {
    try {
      const st = (res.locals as IndexLocals).indexState;
      const catsParam = (req.query.categories as string | undefined) || '';
      const filterCats = catsParam ? catsParam.split(',').filter(Boolean) : [];
      const limitRaw = parseInt((req.query.limit as string) || '0', 10);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 500;
      let instructions = st.list.slice().sort((a, b) => a.id.localeCompare(b.id));
      if (filterCats.length) {
        const set = new Set(filterCats.map(c => c.toLowerCase()));
        instructions = instructions.filter(i => (i.categories || []).some(c => set.has(c.toLowerCase())));
      }
      instructions = instructions.slice(0, limit);
      const flat = instructions.map(i => ({ id: i.id, primaryCategory: i.primaryCategory || i.categories?.[0], categories: i.categories || [] }));
      res.json({ success: true, instructions: flat, count: flat.length, filtered: !!filterCats.length, timestamp: Date.now() });
    } catch (err) {
      logError('[graph/instructions] Error:', err);
      res.status(500).json({ success: false, error: 'Failed to get instructions' });
    }
  });

  /**
   * GET /api/graph/relations?instructions=id1,id2
   * Returns minimal edges among the provided instruction ids plus category linkage.
   */
  router.get('/graph/relations', (req: Request, res: Response) => {
    try {
      const idsParam = (req.query.instructions as string | undefined) || '';
      const ids = idsParam.split(',').filter(Boolean);
      if (!ids.length) { return res.json({ success: true, nodes: [], edges: [], categories: [], timestamp: Date.now() }); }
      const graph = buildGraph({ enrich: true, includeCategoryNodes: true, includeUsage: false });
      const expand = (req.query.expand === '1' || req.query.expand === 'true');
      const selectedSet = new Set(ids);
      const workingSet = new Set(ids);
      const firstEdges = graph.edges.filter(e => selectedSet.has(e.from) || selectedSet.has(e.to));
      if (expand) {
        const instructionNodeIds = new Set(graph.nodes.filter(n => (n as { nodeType?: string }).nodeType === 'instruction').map(n => n.id));
        for (const e of firstEdges) {
          if (instructionNodeIds.has(e.from) && !workingSet.has(e.from)) workingSet.add(e.from);
          if (instructionNodeIds.has(e.to) && !workingSet.has(e.to)) workingSet.add(e.to);
        }
      }
      const nodesAll = graph.nodes.filter(n => workingSet.has(n.id) || (n as { nodeType?: string }).nodeType === 'category');
      const edges = graph.edges.filter(e => workingSet.has(e.from) && workingSet.has(e.to) && (selectedSet.has(e.from) || selectedSet.has(e.to)));
      const categoryRefs = new Set<string>();
      for (const e of edges) {
        if (e.type === 'belongs' || e.type === 'primary') {
          if (e.to.startsWith('category:')) categoryRefs.add(e.to);
          if (e.from.startsWith('category:')) categoryRefs.add(e.from);
        }
      }
      const finalNodes = nodesAll.filter(n => !('nodeType' in n && (n as { nodeType?: string }).nodeType === 'category') || categoryRefs.has(n.id));
      const categories = [...categoryRefs].map(id => ({ id: id.replace(/^category:/, '') }));
      const expandedCount = workingSet.size - selectedSet.size;
      res.json({ success: true, nodes: finalNodes, edges, categories, expanded: expand ? expandedCount : 0, timestamp: Date.now() });
    } catch (err) {
      logError('[graph/relations] Error:', err);
      res.status(500).json({ success: false, error: 'Failed to get relations' });
    }
  });

  return router;
}
