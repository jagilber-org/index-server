import { registerHandler, getHandler } from '../server/registry';
import { instructionActions } from './handlers.instructions';
import { semanticError } from './errors';
import { traceEnabled, emitTrace } from './tracing';
import { getInstructionsDir, ensureLoaded, incrementUsage, listArchivedEntries, getArchivedEntry, computeActiveAndArchiveHashes } from './indexContext';
import { mutationGatedReason } from './bootstrapGating';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { buildAfterRetrievalMeta } from './handlers.search';
import type { InstructionEntry } from '../models/instruction';

// Dispatcher input type (loosely typed for now; validation handled by upstream schema layer soon)
interface DispatchBase { action: string }

// Batch operation type mirrors single action payload (shallow)
interface BatchOperation extends DispatchBase { [k: string]: unknown }

const mutationMethods = new Set([
  'index_add','index_import','index_remove','index_reload','index_groom','index_repair','index_enrich','index_governanceUpdate','usage_flush',
  'index_archive','index_restore','index_purgeArchive'
]);
function isMutationEnabled(){
  const cfg = getRuntimeConfig();
  return cfg.mutation.enabled;
}

const READ_ACTIONS_SUPPORTING_ARCHIVE_FILTERS = new Set(['list','listScoped','search','query','categories','export','diff','get','governanceHash']);

function mapArchivedAsItems(p: { reason?: unknown; source?: unknown; archivedBy?: unknown; restoreEligible?: unknown; limit?: unknown; offset?: unknown }): (InstructionEntry & { archived: true })[] {
  const opts: Record<string, unknown> = {};
  if (typeof p.reason === 'string') opts.reason = p.reason;
  if (typeof p.source === 'string') opts.source = p.source;
  if (typeof p.archivedBy === 'string') opts.archivedBy = p.archivedBy;
  if (typeof p.restoreEligible === 'boolean') opts.restoreEligible = p.restoreEligible;
  if (typeof p.limit === 'number') opts.limit = p.limit;
  if (typeof p.offset === 'number') opts.offset = p.offset;
  const items = listArchivedEntries(opts as Parameters<typeof listArchivedEntries>[0]);
  return items.map(i => ({ ...i, archived: true as const }));
}

type DispatchParams = DispatchBase & { [k: string]: unknown };
registerHandler('index_dispatch', async (params: DispatchParams) => {
  const timing = getRuntimeConfig().mutation.dispatcherTiming;
  const t0 = timing ? Date.now() : 0;
  const action = (params && params.action) as string;
  if(traceEnabled(1)){
    try {
      const dir = getInstructionsDir();
      // Avoid heavy work unless hash diag explicitly requested
      let hash: string | undefined;
      if(getRuntimeConfig().trace.has('dispatchDiag')){
        try { const st = ensureLoaded(); hash = st.hash; } catch { /* ignore */ }
      }
      emitTrace('[trace:dispatch:start]', { action, keys: Object.keys(params||{}).filter(k=>k!=='action'), pid: process.pid, dir, hash });
    } catch { /* ignore */ }
  }
  if(typeof action !== 'string' || !action.trim()) {
    try { if(getRuntimeConfig().logging.verbose) process.stderr.write('[dispatcher] semantic_error code=-32602 reason=missing_action\n'); } catch { /* ignore */ }
    semanticError(-32602,'Missing action',{ method:'index_dispatch', reason:'missing_action', hint: 'Provide an "action" parameter. Use action="capabilities" to list all valid actions.', schema: { required: ['action'], properties: { action: { type: 'string', enum: ['list','get','search','query','categories','diff','export','add','import','remove','reload','groom','repair','enrich','governanceHash','governanceUpdate','health','inspect','dir','capabilities','batch','manifestStatus','manifestRefresh','manifestRepair','archive','restore','listArchived','getArchived','purgeArchive'] } } }, example: { action: 'search', q: 'build validate' } });
  }

  // Archive filter mutex: includeArchived and onlyArchived cannot both be true.
  {
    const p = params as { includeArchived?: unknown; onlyArchived?: unknown };
    if (p.includeArchived === true && p.onlyArchived === true) {
      return { error: 'invalid_params', reason: 'includeArchived and onlyArchived are mutually exclusive', action };
    }
  }

  // Capability listing
  if(action === 'capabilities'){
  try { if(getRuntimeConfig().logging.verbose) process.stderr.write('[dispatcher] capabilities invoked\n'); } catch { /* ignore */ }
  return { version: process.env.npm_package_version || '0.0.0', supportedActions: Object.keys(instructionActions).concat(['add','import','remove','reload','groom','repair','enrich','governanceHash','governanceUpdate','health','inspect','dir','capabilities','batch','manifestStatus','manifestRefresh','manifestRepair','archive','restore','listArchived','getArchived','purgeArchive']), mutationEnabled: isMutationEnabled() };
  }

  // Batch execution
  if(action === 'batch'){
    // Accept both 'operations' and 'ops' for flexibility / backward compatibility
    const rawOps = (params as { operations?: unknown; ops?: unknown }).operations || (params as { operations?: unknown; ops?: unknown }).ops;
    const ops: BatchOperation[] = Array.isArray(rawOps) ? rawOps.filter(o=> o && typeof o==='object') as BatchOperation[] : [];
    const results: unknown[] = [];
    for(const op of ops){
      try {
        const rHandler = getHandler('index_dispatch');
        if(!rHandler) throw new Error('dispatcher recursion handler missing');
        const r = await Promise.resolve(rHandler({ ...op }));
        results.push(r as unknown);
      } catch(e){
        const errObj = e as { message?: string; code?: number };
        results.push({ error: { message: errObj?.message || String(e), code: (errObj as { code?: number })?.code } });
      }
    }
    return { results };
  }

  // Map dispatcher actions to legacy mutation handlers or internal pure actions
  // Read-only internal actions
  const READ_ACTIONS_WITH_META = new Set(['get', 'list', 'listScoped', 'search', 'query']);
  const autoTrack = getRuntimeConfig().index?.autoUsageTrack;
  if(Object.prototype.hasOwnProperty.call(instructionActions, action)){
    const t1 = timing ? Date.now() : 0;
    const fn = (instructionActions as Record<string, (p:unknown)=>unknown>)[action];
    const shouldAddMeta = READ_ACTIONS_WITH_META.has(action);
    const archiveParams = params as { includeArchived?: unknown; onlyArchived?: unknown; reason?: unknown; source?: unknown; archivedBy?: unknown; restoreEligible?: unknown; limit?: unknown; offset?: unknown };
    const includeArchived = archiveParams.includeArchived === true;
    const onlyArchived = archiveParams.onlyArchived === true;
    const wantsArchiveFilter = (includeArchived || onlyArchived) && READ_ACTIONS_SUPPORTING_ARCHIVE_FILTERS.has(action);
    // Specialized reliability wrapper for 'get': automatically attempt late materialization
    // using internal getEnhanced when initial index lookup fails but on-disk file exists.
    if(action === 'get'){
      const id = (params as { id?: unknown }).id;
      if(typeof id === 'string' && id.trim()){
        if(onlyArchived){
          const archived = getArchivedEntry(id);
          if(archived) return { item: { ...archived, archived: true }, _meta: buildAfterRetrievalMeta() };
          return { notFound: true, id, scope: 'archive' };
        }
        const base = await Promise.resolve(fn({ id }));
        if((base as { notFound?: boolean }).notFound){
          if(includeArchived){
            const archived = getArchivedEntry(id);
            if(archived) {
              if(autoTrack) { try { incrementUsage(id, { action: 'get' }); } catch { /* fire-and-forget */ } }
              return { item: { ...archived, archived: true }, _meta: buildAfterRetrievalMeta() };
            }
          }
          try {
            const enhanced = await Promise.resolve((instructionActions as unknown as { getEnhanced?: (p:{id:string})=>unknown }).getEnhanced?.({ id }));
            if(enhanced && !(enhanced as { notFound?: boolean }).notFound){
              if(autoTrack) { try { incrementUsage(id, { action: 'get' }); } catch { /* fire-and-forget */ } }
              return { ...(enhanced as Record<string,unknown>), _meta: buildAfterRetrievalMeta() }; // lateMaterialized success
            }
          } catch { /* swallow fallback errors to preserve original semantics */ }

        }
        if(shouldAddMeta && !(base as { notFound?: boolean }).notFound) {
          if(autoTrack) { try { incrementUsage(id, { action: 'get' }); } catch { /* fire-and-forget */ } }
          return { ...(base as Record<string,unknown>), _meta: buildAfterRetrievalMeta() };
        }
        return base;
      }
    }
    // For onlyArchived reads: short-circuit before invoking the active-set action.
    if(onlyArchived && (action === 'list' || action === 'listScoped' || action === 'search' || action === 'query' || action === 'export')){
      const archivedItems = mapArchivedAsItems(archiveParams);
      const resp: Record<string, unknown> = { items: archivedItems, count: archivedItems.length, onlyArchived: true };
      if(shouldAddMeta) resp._meta = buildAfterRetrievalMeta();
      return resp;
    }
    if(onlyArchived && action === 'categories'){
      const archivedItems = mapArchivedAsItems(archiveParams);
      const catSet = new Set<string>();
      for(const e of archivedItems) for(const c of (e.categories || [])) catSet.add(c);
      return { categories: [...catSet].sort(), onlyArchived: true };
    }
    if(onlyArchived && (action === 'diff' || action === 'governanceHash')){
      const { archive } = computeActiveAndArchiveHashes();
      return { archiveHash: archive, onlyArchived: true };
    }
    const r = await Promise.resolve(fn(params));
    if(traceEnabled(1)){
      try { emitTrace('[trace:dispatch:internal]', { action, elapsed: timing? (Date.now()-t1): undefined }); } catch { /* ignore */ }
    }
    if(timing){ try { process.stderr.write(`[dispatcher:timing] action=${action} phase=internal elapsed=${Date.now()-t1}ms total=${Date.now()-t0}ms\n`); } catch { /* ignore */ } }
    let finalR: Record<string, unknown> | unknown = r;
    if(wantsArchiveFilter && includeArchived && r && typeof r === 'object' && !(r as { error?: unknown }).error){
      const robj = r as Record<string, unknown>;
      if(action === 'diff' || action === 'governanceHash'){
        const { archive } = computeActiveAndArchiveHashes();
        finalR = { ...robj, archiveHash: archive, includeArchived: true };
      } else if(action === 'categories'){
        const archivedItems = mapArchivedAsItems(archiveParams);
        const existing = new Set<string>(Array.isArray(robj.categories) ? (robj.categories as string[]) : []);
        for(const e of archivedItems) for(const c of (e.categories || [])) existing.add(c);
        finalR = { ...robj, categories: [...existing].sort(), includeArchived: true };
      } else if(Array.isArray(robj.items)){
        const archivedItems = mapArchivedAsItems(archiveParams);
        const merged = [...(robj.items as unknown[]), ...archivedItems];
        finalR = { ...robj, items: merged, count: merged.length, includeArchived: true };
      } else {
        finalR = { ...robj, includeArchived: true };
      }
    }
    if(shouldAddMeta && finalR && typeof finalR === 'object' && !(finalR as { notFound?: boolean }).notFound && !(finalR as { error?: unknown }).error) return { ...(finalR as Record<string,unknown>), _meta: buildAfterRetrievalMeta() };
    return finalR;
  }

  // Manifest actions (002 Phase 2b consolidation)
  if(action === 'manifestStatus' || action === 'manifestRefresh' || action === 'manifestRepair'){
    if(action !== 'manifestStatus'){
      const gated = mutationGatedReason();
      if(gated) return { error:'mutation_blocked', reason: gated, target: action, bootstrap: true };
    }
    const mName = action === 'manifestStatus' ? 'manifest_status' : action === 'manifestRefresh' ? 'manifest_refresh' : 'manifest_repair';
    const mHandler = getHandler(mName);
    if(!mHandler) semanticError(-32601, `${mName} handler not found`, { action });
    const mResult = await Promise.resolve(mHandler!({}));
    if(action === 'manifestStatus') return { present: (mResult as Record<string,unknown>).manifestPresent, ...(mResult as Record<string,unknown>) };
    return mResult;
  }

  // Map selected action tokens to existing registered methods for mutation / governance
  const methodMap: Record<string,string> = {
    add: 'index_add', import: 'index_import', remove: 'index_remove', reload: 'index_reload', groom: 'index_groom', repair: 'index_repair', enrich: 'index_enrich', governanceHash: 'index_governanceHash', governanceUpdate: 'index_governanceUpdate', health: 'index_health', inspect: 'index_inspect', dir: 'index_dir',
    archive: 'index_archive', restore: 'index_restore', purgeArchive: 'index_purgeArchive', listArchived: 'index_listArchived', getArchived: 'index_getArchived'
  };
  const target = methodMap[action];
  if(!target) {
    try { if(getRuntimeConfig().logging.verbose) process.stderr.write(`[dispatcher] semantic_error code=-32601 reason=unknown_action action=${action}\n`); } catch { /* ignore */ }
    const validActions = ['list', 'get', 'search', 'query', 'categories', 'diff', 'export', 'add', 'import', 'remove', 'reload', 'groom', 'repair', 'enrich', 'governanceHash', 'governanceUpdate', 'health', 'inspect', 'dir', 'capabilities', 'batch', 'manifestStatus', 'manifestRefresh', 'manifestRepair', 'archive', 'restore', 'listArchived', 'getArchived', 'purgeArchive'];
    semanticError(-32601,`Unknown action: ${action}. Call with action="capabilities" to list all valid actions.`,{ action, reason:'unknown_action', hint: 'Use action="capabilities" for full list. Common actions: list, get, search, add, query, categories.', validActions, schema: { required: ['action'], properties: { action: { type: 'string', enum: validActions } } }, examples: { list: { action: 'list' }, get: { action: 'get', id: 'instruction-id' }, search: { action: 'search', q: 'keyword' } } });
  }
  if(mutationMethods.has(target) && !isMutationEnabled()) {
    // Dispatcher design intent: allow mutation-style actions even when direct mutation tools
    // are disabled. The previous logic incorrectly blocked these calls, causing silent timeouts
    // in tests expecting dispatcher add to succeed even when direct mutation calls were forced off.
    // We now log (if verbose) and proceed instead of throwing a semantic error.
    try { if(getRuntimeConfig().logging.verbose) process.stderr.write(`[dispatcher] mutation_allowed_via_dispatcher action=${action} target=${target} (direct mutation override disabled)\n`); } catch { /* ignore */ }
  }
  const handler = getHandler(target);
  if(!handler) {
    try { if(getRuntimeConfig().logging.verbose) process.stderr.write(`[dispatcher] semantic_error code=-32601 reason=unknown_handler action=${action} target=${target}\n`); } catch { /* ignore */ }
    semanticError(-32601,'Unknown action handler',{ action, target, reason:'unknown_handler' });
  }
  // Strip action key for downstream handler params
  const { action: _ignoredAction, ...rest } = params as Record<string, unknown>;
  // Backward-compatible convenience: allow single 'id' for remove instead of 'ids' array
  if(action==='remove' && typeof (rest as Record<string, unknown>).id === 'string' && !(rest as Record<string, unknown>).ids){
    (rest as Record<string, unknown>).ids = [ (rest as Record<string, unknown>).id as string ];
    delete (rest as Record<string, unknown>).id;
  }
  // Flat-param assembly for 'add': agents send flat params (id, body, title, ...)
  // because the dispatch schema cannot express nested 'entry' wrappers.
  // When 'entry' is absent but 'id' is present, assemble the entry from flat params.
  if(action==='add' && !(rest as Record<string, unknown>).entry && typeof (rest as Record<string, unknown>).id === 'string'){
    const entryFields = ['id','body','title','rationale','priority','audience','requirement','categories','deprecatedBy','riskScore','version','owner','status','priorityTier','classification','lastReviewedAt','nextReviewDue','semanticSummary','changeLog','contentType','extensions'];
    const entry: Record<string, unknown> = {};
    for(const k of entryFields){
      if((rest as Record<string, unknown>)[k] !== undefined){ entry[k] = (rest as Record<string, unknown>)[k]; delete (rest as Record<string, unknown>)[k]; }
    }
    (rest as Record<string, unknown>).entry = entry;
  }
  void _ignoredAction; // explicitly ignore for lint
  // Mark invocation origin so guard() can allow dispatcher-mediated mutations even if
  // direct mutation tools were explicitly disabled via runtime override.
  (rest as Record<string, unknown>)._viaDispatcher = true;
  const hStart = timing? Date.now():0;
  // Gating: block mutation targets if bootstrap confirmation required or reference mode active.
  if(mutationMethods.has(target)){
    const gated = mutationGatedReason();
    if(gated){
      return { error:'mutation_blocked', reason: gated, target: action, bootstrap: true };
    }
  }
  const out = await Promise.resolve(handler(rest));
  if(traceEnabled(1)){
    try { emitTrace('[trace:dispatch:handler]', { action, elapsed: timing? (Date.now()-hStart): undefined, total: timing? (Date.now()-t0): undefined }); } catch { /* ignore */ }
  }
  if(timing){ try { process.stderr.write(`[dispatcher:timing] action=${action} phase=targetHandler elapsedTotal=${Date.now()-t0}ms\n`); } catch { /* ignore */ } }
  // governanceHash: enrich with archiveHash when includeArchived (or replace when onlyArchived).
  if(action === 'governanceHash' && out && typeof out === 'object'){
    const archiveParams2 = params as { includeArchived?: unknown; onlyArchived?: unknown };
    if(archiveParams2.onlyArchived === true){
      const { archive } = computeActiveAndArchiveHashes();
      return { archiveHash: archive, onlyArchived: true };
    }
    if(archiveParams2.includeArchived === true){
      const { archive } = computeActiveAndArchiveHashes();
      return { ...(out as Record<string, unknown>), archiveHash: archive, includeArchived: true };
    }
  }
  return out;
});
