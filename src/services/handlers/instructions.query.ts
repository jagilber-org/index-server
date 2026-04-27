import fs from 'fs';
import path from 'path';
import { InstructionEntry } from '../../models/instruction';
import { registerHandler } from '../../server/registry';
import { computeGovernanceHash, ensureLoaded, getDebugIndexSnapshot, getInstructionsDir, getInvariantRepairSummary, invalidate } from '../indexContext';
import { BOOTSTRAP_ALLOWLIST } from '../bootstrapGating';
import { ClassificationService } from '../classificationService';
import { incrementCounter } from '../features';
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { emitTrace } from '../tracing';
import { handleInstructionsSearch } from '../handlers.search';
import { limitResponseSize, traceEnvSnapshot, traceInstructionVisibility, traceVisibility } from './instructions.shared';

// Legacy individual instruction handlers removed in favor of unified dispatcher (index_dispatch).
// Internal implementation functions retained below for dispatcher direct invocation.
export const instructionActions = {
  list: (p: { category?: string; expectId?: string; contentType?: string; limit?: number; offset?: number }) => {
    let st = ensureLoaded(); const originalHash = st.hash; let items = st.list;
    if (p?.category) { const c = p.category.toLowerCase(); items = items.filter(i => i.categories.includes(c)); }
    if (p?.contentType) { const ct = p.contentType; items = items.filter(i => (i.contentType || 'instruction') === ct); }
    let attemptedReload = false; const attemptedLate = false;
    if (p?.expectId) {
      const idx = items.findIndex(i => i.id === p.expectId);
      if (idx > 0) { const target = items[idx]; items = [target, ...items.slice(0, idx), ...items.slice(idx + 1)]; }
    }
    if (p?.expectId) {
      try {
        const inIndex = st.byId.has(p.expectId);
        if (!inIndex) {
          attemptedReload = true;
          invalidate(); st = ensureLoaded(); items = st.list;
          if (p.category) { const c2 = p.category.toLowerCase(); items = items.filter(i => i.categories.includes(c2)); }
          if (st.byId.has(p.expectId)) {
            const idx2 = items.findIndex(i => i.id === p.expectId);
            if (idx2 > 0) { const target2 = items[idx2]; items = [target2, ...items.slice(0, idx2), ...items.slice(idx2 + 1)]; }
          }
        }
      } catch { /* ignore repair errors */ }
    }
    if (traceVisibility()) { try { const idsSample = items.slice(0, 5).map(i => i.id); const expectId = p?.expectId; const expectinIndex = expectId ? st.byId.has(expectId) : undefined; emitTrace('[trace:list]', { total: st.list.length, filtered: items.length, sample: idsSample, expectId, expectinIndex, attemptedReload, attemptedLate, originalHash, finalHash: st.hash }); } catch { /* ignore */ } }
    const totalCount = items.length;
    // Apply offset/limit pagination when provided via REST bridge callers
    const offset = typeof p?.offset === 'number' && p.offset > 0 ? p.offset : 0;
    if (offset > 0) { items = items.slice(offset); }
    if (typeof p?.limit === 'number' && p.limit > 0) { items = items.slice(0, p.limit); }
    const resp = limitResponseSize({ hash: st.hash, count: totalCount, items });
    return resp;
  },
  listScoped: (p: { userId?: string; workspaceId?: string; teamIds?: string[] }) => {
    const st = ensureLoaded(); const userId = p.userId?.toLowerCase(); const workspaceId = p.workspaceId?.toLowerCase(); const teamIds = (p.teamIds || []).map(t => t.toLowerCase()); const all = st.list; const matchUser = userId ? all.filter(e => (e.userId || '').toLowerCase() === userId) : []; if (matchUser.length) return { hash: st.hash, count: matchUser.length, scope: 'user', items: matchUser }; const matchWorkspace = workspaceId ? all.filter(e => (e.workspaceId || '').toLowerCase() === workspaceId) : []; if (matchWorkspace.length) return { hash: st.hash, count: matchWorkspace.length, scope: 'workspace', items: matchWorkspace }; const teamSet = new Set(teamIds); const matchTeams = teamIds.length ? all.filter(e => Array.isArray(e.teamIds) && e.teamIds.some(t => teamSet.has(t.toLowerCase()))) : []; if (matchTeams.length) return { hash: st.hash, count: matchTeams.length, scope: 'team', items: matchTeams }; const audienceAll = all.filter(e => e.audience === 'all'); return { hash: st.hash, count: audienceAll.length, scope: 'all', items: audienceAll };
  },
  get: (p: { id: string }) => {
    const st = ensureLoaded(); const item = st.byId.get(p.id);
    if (!item && getRuntimeConfig().instructions.strictVisibility) {
      const enhanced = (instructionActions as unknown as { getEnhanced: (p: { id: string }) => unknown }).getEnhanced({ id: p.id }) as { hash?: string; item?: InstructionEntry; notFound?: boolean };
      if (enhanced.item) return { hash: enhanced.hash || st.hash, item: enhanced.item };
    }
    if (traceVisibility()) { const dir = getInstructionsDir(); emitTrace('[trace:get]', { dir, id: p.id, found: !!item, total: st.list.length, strict: getRuntimeConfig().instructions.strictVisibility }); traceInstructionVisibility(p.id, item ? 'get-found' : 'get-not-found'); if (!item) traceEnvSnapshot('get-not-found'); }
    return item ? { hash: st.hash, item } : { notFound: true, id: p.id, hint: `No instruction found with id "${p.id}". Use action="search" with q="<keyword>" to find valid ids, or action="list" to see all.`, example: { action: 'get', id: 'valid-instruction-id' } };
  },
  getEnhanced: (p: { id: string }) => {
    let st = ensureLoaded(); let item = st.byId.get(p.id); if (item) return { hash: st.hash, item } as const;
    // Not in current in-memory index — force reload from store (covers SQLite and JSON)
    let repaired = false;
    try {
      traceInstructionVisibility(p.id, 'getEnhanced-start');
      invalidate(); st = ensureLoaded(); item = st.byId.get(p.id); if (item) { repaired = true; }
      if (!repaired) {
        incrementCounter('instructions:getLateMaterializeNotFound');
      }
    } catch { /* swallow */ }
    if (traceVisibility()) { emitTrace('[trace:get:late-materialize]', { id: p.id, repaired }); }
    traceInstructionVisibility(p.id, 'getEnhanced-end', { repaired, finalFound: !!item });
    return item ? { hash: st.hash, item } : { notFound: true };
  },
  search: async (p: { q?: string; keywords?: string[]; mode?: 'keyword' | 'regex' | 'semantic'; limit?: number; includeCategories?: boolean; caseSensitive?: boolean; contentType?: string }) => {
    const providedKeywords = Array.isArray(p.keywords)
      ? p.keywords.filter((keyword): keyword is string => typeof keyword === 'string' && keyword.trim().length > 0)
      : [];
    const keywords = providedKeywords.length > 0
      ? providedKeywords
      : (typeof p.q === 'string' && p.q.trim().length > 0 ? [p.q] : []);
    const searchResult = await handleInstructionsSearch({
      keywords,
      mode: p.mode,
      limit: p.limit,
      includeCategories: p.includeCategories ?? true,
      caseSensitive: p.caseSensitive,
      contentType: p.contentType,
    });
    const st = ensureLoaded();
    const items = searchResult.results
      .map(result => st.byId.get(result.instructionId))
      .filter((item): item is InstructionEntry => !!item);
    if (traceVisibility()) {
      const dir = getInstructionsDir();
      const sample = items.slice(0, 5).map(i => i.id);
      emitTrace('[trace:search]', { dir, q: keywords.join(' '), matches: items.length, sample });
    }
    return {
      hash: st.hash,
      count: items.length,
      totalMatches: searchResult.totalMatches,
      items,
      results: searchResult.results,
      query: searchResult.query,
      autoTokenized: searchResult.autoTokenized,
      hints: searchResult.hints,
    };
  },
  diff: (p: { clientHash?: string; known?: { id: string; sourceHash: string }[] }) => {
    const st = ensureLoaded(); const clientHash = p.clientHash; const known = p.known; if (!known && clientHash && clientHash === st.hash) return { upToDate: true, hash: st.hash }; if (known) { const map = new Map<string, string>(); for (const k of known) { if (k && k.id && !map.has(k.id)) map.set(k.id, k.sourceHash); } const added: InstructionEntry[] = []; const updated: InstructionEntry[] = []; const removed: string[] = []; for (const e of st.list) { const prev = map.get(e.id); if (prev === undefined) added.push(e); else if (prev !== e.sourceHash) updated.push(e); } for (const id of map.keys()) { if (!st.byId.has(id)) removed.push(id); } if (!added.length && !updated.length && !removed.length && clientHash === st.hash) return { upToDate: true, hash: st.hash }; return { hash: st.hash, added, updated, removed }; } if (!clientHash || clientHash !== st.hash) return { hash: st.hash, changed: st.list }; return { upToDate: true, hash: st.hash };
  },
  export: (p: { ids?: string[]; metaOnly?: boolean }) => {
    const st = ensureLoaded(); let items = st.list; if (p?.ids?.length) { const want = new Set(p.ids); items = items.filter(i => want.has(i.id)); } if (p?.metaOnly) { items = items.map(i => ({ ...i, body: '' })); } return limitResponseSize({ hash: st.hash, count: items.length, items });
  },
  query: (p: { categoriesAll?: string[]; categoriesAny?: string[]; excludeCategories?: string[]; contentType?: string; priorityMin?: number; priorityMax?: number; priorityTiers?: ('P1' | 'P2' | 'P3' | 'P4')[]; requirements?: InstructionEntry['requirement'][]; text?: string; limit?: number; offset?: number }) => {
    const st = ensureLoaded();
    if (traceVisibility()) {
      try { emitTrace('[trace:query:start]', { pid: process.pid, dir: getInstructionsDir(), keys: Object.keys(p || {}), categoriesAny: p.categoriesAny, categoriesAll: p.categoriesAll, excludeCategories: p.excludeCategories }); } catch { /* ignore */ }
    }
    const norm = (arr?: string[]) => Array.from(new Set((arr || []).filter(x => typeof x === 'string' && x.trim()).map(x => x.toLowerCase())));
    const catsAll = norm(p.categoriesAll); const catsAny = norm(p.categoriesAny); const catsEx = norm(p.excludeCategories);
    const tierSet = new Set((p.priorityTiers || []).filter(t => ['P1', 'P2', 'P3', 'P4'].includes(String(t))) as Array<'P1' | 'P2' | 'P3' | 'P4'>);
    const reqSet = new Set((p.requirements || []).filter(r => ['mandatory', 'critical', 'recommended', 'optional', 'deprecated'].includes(String(r))) as InstructionEntry['requirement'][]);
    const prMin = typeof p.priorityMin === 'number' ? p.priorityMin : undefined; const prMax = typeof p.priorityMax === 'number' ? p.priorityMax : undefined;
    const text = (p.text || '').toLowerCase().trim();
    let items = st.list;
    const instructionsCfg = getRuntimeConfig().instructions;
    const diagActive = instructionsCfg.traceQueryDiag && (catsAll.length || catsAny.length || catsEx.length || text.length);
    type Stage = { stage: string; count: number; note?: string };
    const stages: Stage[] = [];
    const pushStage = (stage: string, note?: string) => { if (diagActive) stages.push({ stage, count: items.length, note }); };
    if (diagActive) pushStage('loaded');
    let preFilterSample: string[] | undefined; if (diagActive) { preFilterSample = items.slice(0, 25).map(i => i.id); }
    const preCount = items.length;
    if (catsAll.length) { items = items.filter(e => catsAll.every(c => e.categories.includes(c))); pushStage('catsAll'); }
    if (catsAny.length) {
      const before = items.length; items = items.filter(e => e.categories.some(c => catsAny.includes(c)));
      pushStage('catsAny', before !== items.length ? undefined : 'no-change');
    }
    if (catsEx.length) { items = items.filter(e => !e.categories.some(c => catsEx.includes(c))); pushStage('catsEx'); }
    if (p?.contentType) { const ct = p.contentType; items = items.filter(i => (i.contentType || 'instruction') === ct); pushStage('contentType'); }
    if (prMin !== undefined) { items = items.filter(e => e.priority >= prMin); pushStage('prMin'); }
    if (prMax !== undefined) { items = items.filter(e => e.priority <= prMax); pushStage('prMax'); }
    if (tierSet.size) { items = items.filter(e => e.priorityTier && tierSet.has(e.priorityTier)); pushStage('tiers'); }
    if (reqSet.size) { items = items.filter(e => reqSet.has(e.requirement)); pushStage('requirements'); }
    if (text) { items = items.filter(e => e.title.toLowerCase().includes(text) || e.body.toLowerCase().includes(text) || (e.semanticSummary || '').toLowerCase().includes(text)); pushStage('text'); }
    const total = items.length;
    const limit = Math.min(Math.max((p.limit ?? 100), 1), 1000);
    const offset = Math.max((p.offset ?? 0), 0);
    const paged = items.slice(offset, offset + limit);
    if (traceVisibility()) {
      const sample = paged.slice(0, 5).map(i => i.id);
      emitTrace('[trace:query]', { applied: { catsAll, catsAny, catsEx, prMin, prMax, tiers: [...tierSet], requirements: [...reqSet], text: text || undefined }, preCount, total, returned: paged.length, sample });
      if (diagActive) {
        const suspicious = paged.length === 0 || paged.length < Math.min(3, preCount);
        if (suspicious) {
          const categoryDiagnostics: Record<string, { present: number; passedAllFilters: number; sampleIds: string[] }> = {};
          for (const c of catsAny) {
            let present = 0; let passed = 0; const sampleIds: string[] = [];
            for (const e of st.list) {
              if (e.categories.includes(c)) { present++; if (items.includes(e)) { passed++; if (sampleIds.length < 5) sampleIds.push(e.id); } }
            }
            categoryDiagnostics[c] = { present, passedAllFilters: passed, sampleIds };
          }
          emitTrace('[trace:query:diag]', { preFilterSample, stages, categoryDiagnostics, finalReturned: paged.length, totalAfterFilters: total, preCount });
        }
      }
    }
    return { hash: st.hash, total, count: paged.length, offset, limit, items: paged, applied: { catsAll, catsAny, catsEx, prMin, prMax, tiers: [...tierSet], requirements: [...reqSet], text: text || undefined } };
  },
  categories: (_p: unknown) => {
    const st = ensureLoaded(); const counts = new Map<string, number>(); for (const e of st.list) { for (const c of e.categories) { counts.set(c, (counts.get(c) || 0) + 1); } } const categories = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })); return { count: categories.length, categories };
  },
  dir: () => {
    const dir = getInstructionsDir(); const st = ensureLoaded(); const files = st.list.map(e => `${e.id}.json`).sort(); return { dir, filesCount: files.length, files };
  }
};

// Deep inspection (diagnostics) — reads from store, not disk
registerHandler('index_inspect', (p: { id: string }) => {
  const id = p.id;
  if (!id) return { error: 'missing id' };
  const st = ensureLoaded();
  const entry = st.byId.get(id);
  if (!entry) {
    // Check if the file exists on disk but was skipped during load (#208)
    const dir = getInstructionsDir();
    const filePath = path.join(dir, `${id}.json`);
    const fileExists = fs.existsSync(filePath);
    if (fileExists) {
      // File exists but wasn't loaded — check loadErrors for the reason
      const loadError = st.loadErrors?.find(e => {
        const fileName = path.basename(e.file);
        return e.file === `${id}.json` || fileName === `${id}.json` || e.file.endsWith(`${path.sep}${id}.json`);
      });
      const skipReason = loadError?.error || 'unknown (file exists but was not loaded)';
      return { id, exists: false, fileMissing: false, skipped: true, skipReason };
    }
    return { id, exists: false, fileMissing: true };
  }
  let schemaErrors: string | undefined; let classificationIssues: string[] | undefined; let normalized: InstructionEntry | undefined;
  try {
    const rec = entry as Partial<InstructionEntry>;
    const missing: string[] = [];
    if (!rec.id) missing.push('missing id');
    if (!rec.title) missing.push('missing title');
    if (!rec.body) missing.push('missing body');
    if (missing.length) schemaErrors = missing.join(', ');
    const classifier = new ClassificationService();
    if (!schemaErrors) {
      classificationIssues = classifier.validate(rec as InstructionEntry);
      if (!classificationIssues.length) { normalized = classifier.normalize(rec as InstructionEntry); }
    }
  } catch (err) { schemaErrors = (err as Error).message; }
  return { id, exists: true, schemaErrors, classificationIssues, normalized, raw: entry };
});

registerHandler('index_health', () => {
  const st = ensureLoaded(); const governanceHash = computeGovernanceHash(st.list); const summary = st.loadSummary || { scanned: st.loadDebug?.scanned ?? st.list.length, accepted: st.list.length, skipped: (st.loadDebug ? (st.loadDebug.scanned - st.loadDebug.accepted) : 0), reasons: {} };
  const total = st.list.length || 1;
  const governanceKeywords = ['constitution', 'quality gate', 'p1 ', 'p0 ', 'lifecycle', 'governance', 'bootstrapper'];
  let governanceLike = 0; let keywordHit = 0;
  for (const e of st.list) {
    const body = (e.body || '').toLowerCase();
    const title = (e.title || '').toLowerCase();
    const composite = title + '\n' + body.slice(0, 2000);
    if (/__governance_seed__/.test(composite) || /^000-bootstrapper/.test(e.id) || /^001-knowledge-index-lifecycle/.test(e.id)) {
      governanceLike++; continue;
    }
    if (governanceKeywords.some(k => composite.includes(k))) { keywordHit++; }
  }
  const leakageRatio = governanceLike / total;
  const effectiveGovernanceLike = (ensureLoaded().list.filter(e => e && (e as { id: string }).id && !BOOTSTRAP_ALLOWLIST.has((e as { id: string }).id)).length === 0) ? 0 : governanceLike;
  let recursionRisk: 'none' | 'warning' | 'critical';
  try {
    const st3 = ensureLoaded();
    const allowlistedCount = st3.list.filter(e => BOOTSTRAP_ALLOWLIST.has(e.id)).length;
    const adjusted = Math.max(0, governanceLike - allowlistedCount);
    recursionRisk = adjusted === 0 ? 'none' : (leakageRatio < 0.01 ? 'warning' : 'critical');
  } catch {
    recursionRisk = effectiveGovernanceLike === 0 ? 'none' : (leakageRatio < 0.01 ? 'warning' : 'critical');
  }
  // #131: surface invariant-repair summary so operators can detect silent reconstruction
  const invariantRepairs = getInvariantRepairSummary();
  const snapshot = path.join(process.cwd(), 'snapshots', 'canonical-instructions.json'); if (!fs.existsSync(snapshot)) return { snapshot: 'missing', hash: st.hash, count: st.list.length, governanceHash, recursionRisk, leakage: { governanceLike, keywordHit, leakageRatio }, summary, invariantRepairs }; try { const raw = JSON.parse(fs.readFileSync(snapshot, 'utf8')) as { items?: { id: string; sourceHash: string }[] }; const snapItems = raw.items || []; const snapMap = new Map(snapItems.map(i => [i.id, i.sourceHash] as const)); const missing: string[] = []; const changed: string[] = []; for (const e of st.list) { const h = snapMap.get(e.id); if (h === undefined) missing.push(e.id); else if (h !== e.sourceHash) changed.push(e.id); } const extra = snapItems.filter(i => !st.byId.has(i.id)).map(i => i.id); return { snapshot: 'present', hash: st.hash, count: st.list.length, missing, changed, extra, drift: missing.length + changed.length + extra.length, governanceHash, recursionRisk, leakage: { governanceLike, keywordHit, leakageRatio }, summary, invariantRepairs }; } catch (e) { return { snapshot: 'error', error: e instanceof Error ? e.message : String(e), hash: st.hash, governanceHash, recursionRisk, leakage: { governanceLike, keywordHit, leakageRatio }, summary, invariantRepairs }; }
});

registerHandler('index_debug', () => {
  const before = getDebugIndexSnapshot();
  const st = ensureLoaded();
  const after = { hash: st.hash, count: st.list.length };
  return { before, after };
});

export {};
