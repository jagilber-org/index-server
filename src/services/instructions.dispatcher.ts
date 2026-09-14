import { registerHandler, getHandler } from '../server/registry';
import { instructionActions } from './handlers.instructions';
import { semanticError } from './errors';
import { traceEnabled, emitTrace } from './tracing';
import { lightenItems } from './handlers/instructions.shared';
import { getInstructionsDir, ensureLoaded, incrementUsage, listArchivedEntries, getArchivedEntry, computeActiveAndArchiveHashes } from './indexContext';
import { mutationGatedReason } from './bootstrapGating';
import { logAudit } from './auditLog';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { buildAfterRetrievalMeta } from './handlers.search';
import type { InstructionEntry } from '../models/instruction';
import { findPackageVersion } from '../utils/version';

const VERSION = findPackageVersion(__dirname);

// Dispatcher input type (loosely typed for now; validation handled by upstream schema layer soon)
interface DispatchBase { action: string }

// Batch operation type mirrors single action payload (shallow)
interface BatchOperation extends DispatchBase { [k: string]: unknown }

const mutationMethods = new Set([
  'index_add','index_import','index_remove','index_reload','index_groom','index_repair','index_enrich','index_governanceUpdate','usage_flush',
  'index_archive','index_restore','index_purgeArchive','index_patch'
]);
function isMutationEnabled(){
  const cfg = getRuntimeConfig();
  return cfg.mutation.enabled;
}

const MUTATION_DISABLED_HINT =
  'INDEX_SERVER_MUTATION=0 makes this an explicit read-only runtime (constitution S-3). Dispatcher-mediated mutations are REFUSED, not deferred — nothing was written. Restart the server without INDEX_SERVER_MUTATION=0 to re-enable writes.';

/**
 * Build the refusal envelope for a mutation action attempted under a read-only
 * runtime, and audit it.
 *
 * The audit row is emitted explicitly with kind 'mutation' because
 * `index_dispatch` lives in STABLE rather than MUTATION, so the registry's
 * automatic tool-audit would file this refusal as a mere read (A-5). Mirrors
 * the existing `logAudit('remove_blocked', …)` precedent.
 */
function mutationDisabledEnvelope(action: string, target: string){
  logAudit('mutation_blocked', undefined, { tool: 'index_dispatch', action, target, reason: 'mutation_disabled' }, 'mutation');
  return { error: 'mutation_blocked', reason: 'mutation_disabled', target: action, mutationEnabled: false, mutationHint: MUTATION_DISABLED_HINT };
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

  // Handler registry for mutation/governance actions (hoisted for capabilities + error derivation)
  const methodMap: Record<string,string> = {
    add: 'index_add', import: 'index_import', remove: 'index_remove', reload: 'index_reload', groom: 'index_groom', repair: 'index_repair', enrich: 'index_enrich', governanceHash: 'index_governanceHash', governanceUpdate: 'index_governanceUpdate', health: 'index_health', inspect: 'index_inspect', dir: 'index_dir',
    patch: 'index_patch',
    archive: 'index_archive', restore: 'index_restore', purgeArchive: 'index_purgeArchive', listArchived: 'index_listArchived', getArchived: 'index_getArchived'
  };
  const validActions = [...new Set([...Object.keys(instructionActions), ...Object.keys(methodMap), 'capabilities', 'batch', 'manifestStatus', 'manifestRefresh', 'manifestRepair'])];
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
    semanticError(-32602,'Missing action',{ method:'index_dispatch', reason:'missing_action', hint: 'Provide an "action" parameter. Use action="capabilities" to list all valid actions.', schema: { required: ['action'], properties: { action: { type: 'string', enum: validActions } } }, example: { action: 'search', q: 'build validate' } });
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
  return { version: VERSION, supportedActions: validActions, mutationEnabled: isMutationEnabled() };
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
        const getParams: { id: string; bodyOffset?: number; bodyLimit?: number } = { id };
        const boRaw = (params as { bodyOffset?: unknown }).bodyOffset;
        const blRaw = (params as { bodyLimit?: unknown }).bodyLimit;
        if(typeof boRaw === 'number') getParams.bodyOffset = boRaw;
        if(typeof blRaw === 'number') getParams.bodyLimit = blRaw;
        const base = await Promise.resolve(fn(getParams));
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
      const lightenArchived = (action === 'list' || action === 'search') && (params as { includeBody?: unknown }).includeBody !== true;
      const emitted = lightenArchived ? lightenItems(archivedItems, false) : archivedItems;
      const resp: Record<string, unknown> = { items: emitted, count: emitted.length, onlyArchived: true, ...(lightenArchived ? { bodyLight: true } : {}) };
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
        const lightenArchived = (action === 'list' || action === 'search') && (params as { includeBody?: unknown }).includeBody !== true;
        const archivedEmitted = lightenArchived ? lightenItems(archivedItems, false) : archivedItems;
        const merged = [...(robj.items as unknown[]), ...archivedEmitted];
        finalR = { ...robj, items: merged, count: merged.length, includeArchived: true };
      } else {
        finalR = { ...robj, includeArchived: true };
      }
    }
    // Auto-track scope (issue #418): record retrievals for query (top-3 results)
    // and explicit-id export. Search auto-tracks in handlers.search.ts; get is
    // handled above. List/listScoped remain untracked (browse, not retrieval).
    if(autoTrack && finalR && typeof finalR === 'object' && !(finalR as { error?: unknown }).error){
      try {
        if(action === 'query'){
          const items = (finalR as { items?: Array<{ id?: unknown }> }).items;
          if(Array.isArray(items)){
            for(const it of items.slice(0, 3)){
              const id = it?.id;
              if(typeof id === 'string' && id) { try { incrementUsage(id, { action: 'query', kind: 'retrieved' }); } catch { /* fire-and-forget */ } }
            }
          }
        } else if(action === 'export'){
          const exportIds = (params as { ids?: unknown }).ids;
          if(Array.isArray(exportIds)){
            for(const id of exportIds){
              if(typeof id === 'string' && id) { try { incrementUsage(id, { action: 'export', kind: 'retrieved' }); } catch { /* fire-and-forget */ } }
            }
          }
        }
      } catch { /* fire-and-forget */ }
    }
    if(shouldAddMeta && finalR && typeof finalR === 'object' && !(finalR as { notFound?: boolean }).notFound && !(finalR as { error?: unknown }).error) {
      return { ...(finalR as Record<string,unknown>), _meta: buildAfterRetrievalMeta() };
    }
    return finalR;
  }

  // Manifest actions (002 Phase 2b consolidation)
  if(action === 'manifestStatus' || action === 'manifestRefresh' || action === 'manifestRepair'){
    if(action !== 'manifestStatus'){
      // Issue #580: this branch checked bootstrap gating but never the mutation
      // flag, so manifestRefresh/manifestRepair wrote _manifest.json under a
      // runtime the operator had declared read-only. Both targets are in the
      // MUTATION set; manifestStatus is a read and stays open.
      const mTarget = action === 'manifestRefresh' ? 'manifest_refresh' : 'manifest_repair';
      if(!isMutationEnabled()) return mutationDisabledEnvelope(action, mTarget);
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

  const target = methodMap[action];
  if(!target) {
    try { if(getRuntimeConfig().logging.verbose) process.stderr.write(`[dispatcher] semantic_error code=-32601 reason=unknown_action action=${action}\n`); } catch { /* ignore */ }
    semanticError(-32601,`Unknown action: ${action}. Call with action="capabilities" to list all valid actions.`,{ action, reason:'unknown_action', hint: 'Use action="capabilities" for full list. Common actions: list, get, search, add, query, categories.', validActions, schema: { required: ['action'], properties: { action: { type: 'string', enum: validActions } } }, examples: { list: { action: 'list' }, get: { action: 'get', id: 'instruction-id' }, search: { action: 'search', q: 'keyword' } } });
  }
  if(mutationMethods.has(target) && !isMutationEnabled()) {
    // Issue #580 / constitution S-3. This branch previously annotated the
    // response with `mutationEnabled:false` and PROCEEDED WITH THE WRITE — the
    // issue #358 design intent, whose comment read "we DO still proceed". That
    // made INDEX_SERVER_MUTATION=0 mean only "direct mutation tools are off"
    // rather than "read-only runtime". Measured over stdio: with the flag set,
    // {action:'add'} wrote a file and {action:'remove',mode:'purge'} deleted
    // one. The #358 contract — an actionable `mutationEnabled` + `mutationHint`
    // on the response — is preserved here; only the write is now refused.
    try { if(getRuntimeConfig().logging.verbose) process.stderr.write(`[dispatcher] mutation_blocked action=${action} target=${target} reason=mutation_disabled\n`); } catch { /* ignore */ }
    return mutationDisabledEnvelope(action, target);
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
    const entryFields = ['id','body','title','rationale','priority','audience','requirement','categories','deprecatedBy','riskScore','version','owner','status','priorityTier','classification','lastReviewedAt','nextReviewDue','semanticSummary','changeLog','contentType','extensions','links'];
    const entry: Record<string, unknown> = {};
    for(const k of entryFields){
      if((rest as Record<string, unknown>)[k] !== undefined){ entry[k] = (rest as Record<string, unknown>)[k]; delete (rest as Record<string, unknown>)[k]; }
    }
    (rest as Record<string, unknown>).entry = entry;
  }
  void _ignoredAction; // explicitly ignore for lint
  // No origin stamp is written here. `guard()` used to treat `_viaDispatcher`
  // as permission to mutate under INDEX_SERVER_MUTATION=0, which any client
  // could forge (issue #580). The mutation refusal above now happens before we
  // ever reach a handler, so the flag has no remaining purpose (CQ-5).
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
  // Issue #358's response annotation used to be applied here, on the way OUT of
  // a mutation that had already run. Since #580 a mutation action under a
  // read-only runtime returns `mutationDisabledEnvelope()` before the handler
  // is called, so `mutationEnabled` / `mutationHint` are carried by the refusal
  // itself and there is nothing left to annotate on the success path.
  return out;
});
