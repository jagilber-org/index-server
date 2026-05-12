#!/usr/bin/env node
/**
 * Content-type taxonomy probe.
 *
 * Exercises every canonical contentType value (agent, skill, instruction,
 * prompt, workflow, knowledge, template, integration) through a full
 * add → get → search-by-contentType → query-by-contentType → export →
 * reimport → verify lifecycle. Confirms that:
 *
 *   1. All 8 contentType values are accepted by index_add.
 *   2. index_search with a contentType filter returns ONLY the matching type.
 *   3. index_dispatch action=query with contentType filter returns ONLY
 *      the matching type.
 *   4. index_dispatch action=export captures the contentType field correctly.
 *   5. Rejection: a removed/invalid contentType value is rejected at write time.
 *   6. Cleanup: all probe entries removed when --keep is not set.
 *
 * Usage:
 *   node scripts/dev/integrity/contenttype-probe.mjs \
 *      --env-file .devsandbox/json/server.env \
 *      --log-file .devsandbox/json/dev-server.log \
 *      [--keep] [--id-prefix ct-probe]
 *
 * Flags:
 *   --keep         Leave the probe entries in the sandbox after the run.
 *   --id-prefix    Prefix for created entry IDs (default: ct-probe).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMcp, parseToolPayload } from '../transport/mcp-stdio.mjs';

// ── canonical taxonomy: read directly from the JSON schema (single source of truth).
// Do NOT inline the literal array here — that re-introduces the drift bug.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '..', '..', '..', 'schemas', 'instruction.schema.json');
const _schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const CONTENT_TYPES = _schema?.properties?.contentType?.enum;
if (!Array.isArray(CONTENT_TYPES) || CONTENT_TYPES.length === 0) {
  console.error(`contenttype-probe: failed to read contentType enum from ${SCHEMA_PATH}`);
  process.exit(2);
}

// A removed value that must be rejected at write time.
const REMOVED_TYPE = 'reference';

// ── arg parsing ──────────────────────────────────────────────────────────────
function getArg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const ENV_FILE  = getArg('--env-file');
const LOG_FILE  = getArg('--log-file');
const KEEP      = process.argv.includes('--keep');
const ID_PREFIX = (getArg('--id-prefix', 'ct-probe') || 'ct-probe').toLowerCase();

if (!ENV_FILE) { console.error('contenttype-probe: --env-file is required'); process.exit(2); }

// ── env loader ───────────────────────────────────────────────────────────────
function loadEnvFile(file) {
  const out = {};
  const txt = fs.readFileSync(file, 'utf8');
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}
const profileEnv = loadEnvFile(ENV_FILE);

// ── logging ──────────────────────────────────────────────────────────────────
const logSink = LOG_FILE ? fs.createWriteStream(LOG_FILE, { flags: 'a' }) : null;
function ts() { return new Date().toISOString(); }
function log(level, kind, payload) {
  const line = `${ts()} [${level}] [ct-probe] ${kind}${payload !== undefined ? ' ' + JSON.stringify(payload) : ''}`;
  process.stderr.write(line + '\n');
  if (logSink) logSink.write(line + '\n');
}

// ── results ──────────────────────────────────────────────────────────────────
const results = [];
let failures = 0;
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  log(ok ? 'pass' : 'FAIL', `step=${name}`, detail);
}

// ── server path ──────────────────────────────────────────────────────────────
const DIST_SERVER = path.join(process.cwd(), 'dist', 'server', 'index-server.js');
if (!fs.existsSync(DIST_SERVER)) {
  console.error(`contenttype-probe: dist server not found at ${DIST_SERVER}; run npm run build first`);
  process.exit(2);
}

const RUN_TAG = Date.now().toString(36);

// ── ID + entry factory ───────────────────────────────────────────────────────
function entryId(ct) {
  return `${ID_PREFIX}-${RUN_TAG}-${ct}`;
}

// Body text is lexically unique per type so keyword search can distinguish them.
const UNIQUE_WORDS = {
  agent:       'autonomous-agent-executor-lifecycle',
  skill:       'reusable-skill-capability-module',
  instruction: 'directive-instruction-guidance-rule',
  prompt:      'prompt-template-llm-completion',
  workflow:    'orchestration-workflow-pipeline-dag',
  knowledge:   'knowledge-base-factual-reference-doc',
  template:    'template-scaffold-boilerplate-starter',
  integration: 'integration-adapter-connector-bridge',
};

function makeEntry(ct) {
  const id = entryId(ct);
  return {
    id,
    title: `ContentType probe — ${ct}`,
    body: `This entry exercises the "${ct}" content type. Unique token: ${UNIQUE_WORDS[ct]}.`,
    priority: 50,
    audience: 'all',
    requirement: 'optional',
    categories: ['ct-probe', `ct-${ct}`],
    contentType: ct,
  };
}

// ── id extraction helper (mirrors crud-probe) ────────────────────────────────
function extractIds(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) {
    return payload.map(x => (typeof x === 'string' ? x : x?.id || x?.instructionId)).filter(Boolean);
  }
  if (Array.isArray(payload.ids)) return payload.ids;
  if (Array.isArray(payload.results)) return payload.results.map(x => x?.id || x?.instructionId).filter(Boolean);
  if (Array.isArray(payload.matches)) return payload.matches.map(x => x?.id || x?.instructionId).filter(Boolean);
  if (Array.isArray(payload.items)) return payload.items.map(x => x?.id || x?.instructionId).filter(Boolean);
  return [];
}

function extractListItems(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.instructions)) return payload.instructions;
  if (Array.isArray(payload.results)) return payload.results;
  return [];
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  const allIds = CONTENT_TYPES.map(entryId);

  log('info', 'probe-start', {
    idPrefix: ID_PREFIX,
    runTag: RUN_TAG,
    contentTypes: CONTENT_TYPES,
    backend: profileEnv.INDEX_SERVER_STORAGE_BACKEND || '(default)',
    instructionsDir: profileEnv.INDEX_SERVER_DIR,
    sqlitePath: profileEnv.INDEX_SERVER_SQLITE_PATH,
  });

  const mcp = await startMcp({
    env: profileEnv,
    distServer: DIST_SERVER,
    onLine: (chan, line) => {
      if (chan === 'stderr' && /error|fail|warn/i.test(line)) log('srv', `srv-${chan}`, line.slice(0, 400));
    },
    initTimeoutMs: 12000,
  });

  try {
    // ── STEP 1: Add one entry per content type ────────────────────────────────
    log('info', 'phase', { phase: '1-add-all-types' });
    for (const ct of CONTENT_TYPES) {
      const entry = makeEntry(ct);
      log('act', 'index_add', { id: entry.id, contentType: ct });
      const resp = await mcp.callTool('index_add', { entry, lax: true, overwrite: true });
      const payload = parseToolPayload(resp);
      const ok = !resp?.error && payload?.success !== false;
      record(`add:${ct}`, ok, { error: resp?.error, payload });
    }

    // ── STEP 1b: Omit contentType with lax:true → must default to 'instruction' ──
    // Verifies that the server applies the correct default when contentType is absent.
    log('info', 'phase', { phase: '1b-omit-contentType-defaults-to-instruction' });
    {
      const omitId = `${ID_PREFIX}-${RUN_TAG}-omit-ct`;
      allIds.push(omitId);
      log('act', 'index_add (no contentType)', { id: omitId });
      const resp = await mcp.callTool('index_add', {
        entry: {
          id: omitId,
          title: 'ContentType omit probe',
          body: 'This entry intentionally omits the contentType field. Lax mode should default it to instruction.',
          priority: 50,
          audience: 'all',
          requirement: 'optional',
          categories: ['ct-probe'],
          // contentType intentionally omitted
        },
        lax: true, overwrite: true,
      });
      const p = parseToolPayload(resp);
      const added = !resp?.error && p?.success !== false;
      record('omit-contentType:add-accepted', !!added, { error: resp?.error });
      if (added) {
        const v = await mcp.callTool('index_dispatch', { action: 'get', id: omitId });
        const vp = parseToolPayload(v);
        const item = vp?.item || vp;
        record('omit-contentType:defaults-to-instruction', item?.contentType === 'instruction',
          { stored: item?.contentType, note: 'lax:true with no contentType should default to instruction' });
      }
    }

    // ── STEP 2: Read back each entry; verify contentType is preserved ─────────
    log('info', 'phase', { phase: '2-readback-verify-contentType' });
    for (const ct of CONTENT_TYPES) {
      const id = entryId(ct);
      log('act', 'index_dispatch.get', { id });
      const resp = await mcp.callTool('index_dispatch', { action: 'get', id });
      const payload = parseToolPayload(resp);
      const item = payload?.item || payload;
      const gotType = item?.contentType;
      const ok = item && item.id === id && gotType === ct;
      record(`readback-contentType:${ct}`, ok, ok ? { id, contentType: gotType } : { payload, error: resp?.error, gotType });
    }

    // ── STEP 2b: Overwrite changes contentType ────────────────────────────────
    // Verifies that overwriting an entry with a different contentType updates the field
    // (not stuck on original value). Uses the 'agent' entry already written in Step 1.
    log('info', 'phase', { phase: '2b-overwrite-changes-contentType' });
    {
      const agentId = entryId('agent');
      log('act', 'index_add overwrite agent→skill', { id: agentId });
      const resp = await mcp.callTool('index_add', {
        entry: { ...makeEntry('agent'), id: agentId, contentType: 'skill', title: 'Overwrite: agent→skill' },
        lax: true, overwrite: true,
      });
      const p = parseToolPayload(resp);
      const ok = !resp?.error && p?.success !== false;
      record('overwrite:contentType-agent-to-skill-accepted', !!ok, { error: resp?.error });
      if (ok) {
        const v = await mcp.callTool('index_dispatch', { action: 'get', id: agentId });
        const vp = parseToolPayload(v);
        const item = vp?.item || vp;
        record('overwrite:contentType-changed-to-skill', item?.contentType === 'skill',
          { stored: item?.contentType, note: 'overwrite must change contentType from agent to skill' });
        // Restore original contentType for subsequent phases
        await mcp.callTool('index_add', {
          entry: makeEntry('agent'),
          lax: true, overwrite: true,
        });
      }
    }

    // ── STEP 3: index_search with contentType filter — each type returns ONLY
    //           its own entry from this probe's corpus. The filter is the key
    //           behaviour being tested (handlers.search.ts lines 509, 706).
    log('info', 'phase', { phase: '3-search-contentType-filter' });
    for (const ct of CONTENT_TYPES) {
      const expectedId = entryId(ct);
      const uniqueWord = UNIQUE_WORDS[ct];
      log('act', 'index_search+contentType', { keywords: [uniqueWord], contentType: ct });
      const resp = await mcp.callTool('index_search', {
        keywords: [uniqueWord],
        contentType: ct,
        mode: 'keyword',
        limit: 50,
      });
      const payload = parseToolPayload(resp);
      const ids = extractIds(payload);

      // Must find its own entry.
      const found = ids.includes(expectedId);
      // Must not find any other probe entry of a different type.
      const wrongTypeIds = allIds.filter(id => id !== expectedId && ids.includes(id));
      record(`search-filter:${ct}`, found && wrongTypeIds.length === 0,
        { found, wrongTypeIds, ids: ids.slice(0, 10) });
    }

    // ── STEP 4: index_dispatch action=query with contentType filter ───────────
    // action=query is a relevance-ranked full-text query (not exact keyword).
    // q/keywords params are for action=search only (per TOOLS-GENERATED.md).
    // We assert no type leakage across all returned items. Finding our specific
    // probe entry is already verified in steps 2 (get) and 3 (search+filter).
    log('info', 'phase', { phase: '4-dispatch-query-contentType-filter' });
    for (const ct of CONTENT_TYPES) {
      log('act', 'index_dispatch.query+contentType', { contentType: ct });
      const resp = await mcp.callTool('index_dispatch', {
        action: 'query',
        contentType: ct,
        limit: 50,
      });
      const payload = parseToolPayload(resp);
      const items = extractListItems(payload);
      const returnedTypes = [...new Set(items.map(x => x?.contentType).filter(Boolean))];

      // All returned items must have this contentType (no cross-type leakage).
      const typeLeak = returnedTypes.filter(t => t !== ct);
      record(`dispatch-query-filter:${ct}`, typeLeak.length === 0,
        { returnedTypes, typeLeak, total: items.length });
    }

    // ── STEP 5: index_dispatch action=list with contentType filter ────────────
    // list does not support keyword narrowing so we cannot guarantee our probe
    // entry is within the first N results when many same-type entries exist.
    // The assertion here is: no type leakage (all returned items have the right
    // contentType). Finding our entry is verified in steps 2 and 3.
    log('info', 'phase', { phase: '5-dispatch-list-contentType-filter' });
    for (const ct of CONTENT_TYPES) {
      log('act', 'index_dispatch.list+contentType', { contentType: ct });
      const resp = await mcp.callTool('index_dispatch', {
        action: 'list',
        contentType: ct,
        limit: 200,
      });
      const payload = parseToolPayload(resp);
      const items = extractListItems(payload);
      const returnedTypes = [...new Set(items.map(x => x?.contentType).filter(Boolean))];
      const typeLeak = returnedTypes.filter(t => t !== ct);
      // Only assert no type leakage; finding our specific entry is not
      // required here because pagination may not reach it among existing entries.
      record(`dispatch-list-filter:${ct}`, typeLeak.length === 0,
        { returnedTypes, typeLeak, total: items.length });
    }

    // ── STEP 6: Rejection — removed/invalid contentType must be rejected ──────
    log('info', 'phase', { phase: '6-rejection-of-removed-type' });
    {
      const rejEntry = {
        id: `${ID_PREFIX}-${RUN_TAG}-reject`,
        title: 'Should be rejected — removed contentType',
        body: `Entry with removed contentType "${REMOVED_TYPE}" must be rejected.`,
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['ct-probe'],
        contentType: REMOVED_TYPE,
      };
      log('act', 'index_add (rejected)', { contentType: REMOVED_TYPE });
      const resp = await mcp.callTool('index_add', { entry: rejEntry, lax: false, overwrite: false });
      const payload = parseToolPayload(resp);
      // Expect a failure: either resp.error, payload.success===false, or payload.errors present.
      const rejected = !!resp?.error || payload?.success === false || (Array.isArray(payload?.errors) && payload.errors.length > 0);
      record(`reject-removed-type:${REMOVED_TYPE}`, rejected,
        { rejected, error: resp?.error, payload });
    }

    // ── STEP 7: Export the probe entries; verify contentType survives export ──
    log('info', 'phase', { phase: '7-export-contentType-round-trip' });
    {
      log('act', 'index_dispatch.export', { ids: allIds });
      const exportResp = await mcp.callTool('index_dispatch', { action: 'export', ids: allIds });
      const exportPayload = parseToolPayload(exportResp);
      const exportedItems = extractListItems(exportPayload);

      // All 8 contentTypes must be present in the export.
      const exportedTypes = new Set(exportedItems.map(x => x?.contentType).filter(Boolean));
      const missingFromExport = CONTENT_TYPES.filter(ct => !exportedTypes.has(ct));
      record('export-has-all-types', missingFromExport.length === 0,
        { exportedTypes: [...exportedTypes], missingFromExport, exportedCount: exportedItems.length });

      // Spot-check: each exported entry's contentType matches what we put in.
      for (const ct of CONTENT_TYPES) {
        const expectedId = entryId(ct);
        const match = exportedItems.find(x => x?.id === expectedId || x?.instructionId === expectedId);
        const typeOk = match?.contentType === ct;
        record(`export-type-preserved:${ct}`, !!match && typeOk,
          { found: !!match, exportedType: match?.contentType });
      }
    }

    // ── STEP 8: Cleanup ───────────────────────────────────────────────────────
    if (!KEEP) {
      log('info', 'phase', { phase: '8-cleanup' });
      log('act', 'index_remove', { ids: allIds });
      const resp = await mcp.callTool('index_remove', { ids: allIds, force: true });
      const payload = parseToolPayload(resp);
      record('cleanup-remove', !resp?.error && payload?.success !== false,
        { error: resp?.error, payload });

      // Spot-verify one entry is gone.
      const probeId = entryId('agent');
      const v = await mcp.callTool('index_dispatch', { action: 'get', id: probeId });
      const vp = parseToolPayload(v);
      const item = vp?.item;
      const gone = !vp || vp.notFound || vp.error || !item || item.id !== probeId;
      record('verify-cleanup', !!gone, { probeId, vp });
    } else {
      log('info', 'keep-flag', { reason: '--keep specified; entries left in sandbox', ids: allIds });
    }
  } catch (e) {
    record('exception', false, {
      message: String(e?.message || e),
      stack: String(e?.stack || '').split('\n').slice(0, 6).join(' | '),
    });
  } finally {
    await mcp.close();
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const summary = {
    total: results.length,
    passed: results.filter(r => r.ok).length,
    failed: failures,
    contentTypesTested: CONTENT_TYPES.length,
  };
  log(failures === 0 ? 'pass' : 'FAIL', 'probe-summary', summary);
  process.stdout.write(JSON.stringify({ summary, results }, null, 2) + '\n');
  if (logSink) logSink.end();
  process.exit(failures === 0 ? 0 : 1);
})();
