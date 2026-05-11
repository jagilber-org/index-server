#!/usr/bin/env node
/**
 * Dev-server CRUD probe.
 *
 * Spawns a short-lived MCP stdio child process against a profile sandbox and
 * exercises a complete CRUD lifecycle PLUS keyword + semantic search, with
 * verify-after-mutation read-backs. Logs each action AND each result.
 *
 * Designed to be invoked by scripts/dev/dev-server.ps1 with --env-file pointing
 * at the profile's serialized env. Exits non-zero on any verification failure.
 *
 * Usage:
 *   node scripts/dev/lib/crud-probe.mjs \
 *      --env-file .devsandbox/sqlite-embed/server.env \
 *      --log-file .devsandbox/sqlite-embed/dev-server.log \
 *      [--keep] [--id-prefix dev-probe]
 *
 * Flags:
 *   --keep         Leave the probe entries in the sandbox after the run.
 *   --id-prefix    Prefix for created entry IDs (default: dev-probe).
 *   --skip-semantic  Don't attempt semantic-mode search (still does keyword).
 */
import fs from 'node:fs';
import path from 'node:path';
import { startMcp, parseToolPayload } from '../transport/mcp-stdio.mjs';

// ── arg parsing ─────────────────────────────────────────────────────────────
function getArg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const ENV_FILE = getArg('--env-file');
const LOG_FILE = getArg('--log-file');
const KEEP = process.argv.includes('--keep');
const SKIP_SEMANTIC = process.argv.includes('--skip-semantic');
const ID_PREFIX = (getArg('--id-prefix', 'dev-probe') || 'dev-probe').toLowerCase();

if (!ENV_FILE) { console.error('crud-probe: --env-file is required'); process.exit(2); }

// ── env loader (KEY=VALUE per line; lines starting with # ignored) ──────────
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

// ── logging (action + result) ───────────────────────────────────────────────
const logSink = LOG_FILE ? fs.createWriteStream(LOG_FILE, { flags: 'a' }) : null;
function ts() { return new Date().toISOString(); }
function log(level, kind, payload) {
  const line = `${ts()} [${level}] [crud] ${kind}${payload !== undefined ? ' ' + JSON.stringify(payload) : ''}`;
  process.stderr.write(line + '\n');
  if (logSink) logSink.write(line + '\n');
}

// ── results aggregator ──────────────────────────────────────────────────────
const results = [];
let failures = 0;
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  log(ok ? 'pass' : 'FAIL', `step=${name}`, detail);
}

// ── helpers ─────────────────────────────────────────────────────────────────
const DIST_SERVER = path.join(process.cwd(), 'dist', 'server', 'index-server.js');
if (!fs.existsSync(DIST_SERVER)) {
  console.error(`crud-probe: dist server not found at ${DIST_SERVER}; run npm run build first`);
  process.exit(2);
}

const RUN_TAG = Date.now().toString(36);
const ID_A = `${ID_PREFIX}-${RUN_TAG}-alpha`;
const ID_B = `${ID_PREFIX}-${RUN_TAG}-beta`;
const ID_C = `${ID_PREFIX}-${RUN_TAG}-gamma`;
const ID_D = `${ID_PREFIX}-${RUN_TAG}-delta`;  // multi-keyword AND edge-case entry
const PROBE_IDS = [ID_A, ID_B, ID_C, ID_D];

// Distinctive corpus the keyword + semantic search must locate.
const CORPUS = {
  [ID_A]: {
    title: 'Hummingbird migration patterns',
    body: 'Ruby-throated hummingbirds undertake remarkable trans-Gulf flights every spring and fall. Their tiny bodies store fat reserves before crossing.',
  },
  [ID_B]: {
    title: 'Submarine sonar calibration',
    body: 'Active sonar transducers must be calibrated against a reference hydrophone before each deep-dive sortie to ensure accurate target ranging.',
  },
  [ID_C]: {
    title: 'Espresso extraction chemistry',
    body: 'Brew ratio, grind size, and water temperature jointly determine the dissolved solids extracted from the puck. Channeling reduces yield.',
  },
  // ID_D has exactly two unique tokens used to verify AND semantics of multi-keyword search.
  [ID_D]: {
    title: 'Pelican nesting ecology',
    body: 'Brown pelicans establish nesting colonies in coastal mangrove thickets during the dry season. Pelican chicks fledge after approximately eleven weeks.',
  },
};

function makeEntry(id) {
  const c = CORPUS[id];
  return {
    id,
    title: c.title,
    body: c.body,
    priority: 50,
    audience: 'all',
    requirement: 'optional',
    categories: ['dev-probe', 'crud-test'],
    contentType: 'instruction',
  };
}

// ── main ────────────────────────────────────────────────────────────────────
(async () => {
  log('info', 'probe-start', { idPrefix: ID_PREFIX, runTag: RUN_TAG, ids: PROBE_IDS, semantic: !SKIP_SEMANTIC });
  log('info', 'env-summary', {
    backend: profileEnv.INDEX_SERVER_STORAGE_BACKEND || '(default)',
    semantic: profileEnv.INDEX_SERVER_SEMANTIC_ENABLED || '(unset)',
    instructionsDir: profileEnv.INDEX_SERVER_DIR,
    sqlitePath: profileEnv.INDEX_SERVER_SQLITE_PATH,
    embeddingPath: profileEnv.INDEX_SERVER_EMBEDDING_PATH,
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
    // 1) CREATE three entries
    for (const id of PROBE_IDS) {
      const entry = makeEntry(id);
      log('act', 'index_add', { id, title: entry.title });
      const resp = await mcp.callTool('index_add', { entry, lax: true, overwrite: true });
      const payload = parseToolPayload(resp);
      const ok = !resp?.error && (payload?.success !== false);
      record(`add:${id}`, ok, { error: resp?.error, payload });
    }

    // 2) VERIFY READ via index_dispatch action=get
    for (const id of PROBE_IDS) {
      log('act', 'index_dispatch.get', { id });
      const resp = await mcp.callTool('index_dispatch', { action: 'get', id });
      const payload = parseToolPayload(resp);
      const item = payload?.item || payload;
      const found = item && item.id === id && typeof item.body === 'string' && item.body.length > 0;
      record(`read-back:${id}`, !!found, found ? { id: item.id, len: item.body.length } : { payload, error: resp?.error });
    }

    // 3) UPDATE one (overwrite with new body)
    {
      const updated = { ...makeEntry(ID_A), body: CORPUS[ID_A].body + ' Updated at ' + new Date().toISOString() };
      log('act', 'index_add (update)', { id: ID_A });
      const resp = await mcp.callTool('index_add', { entry: updated, lax: true, overwrite: true });
      const payload = parseToolPayload(resp);
      record(`update:${ID_A}`, !resp?.error && (payload?.success !== false), { error: resp?.error, payload });

      const verify = await mcp.callTool('index_dispatch', { action: 'get', id: ID_A });
      const vp = parseToolPayload(verify);
      const vItem = vp?.item || vp;
      const updatedOk = vItem && vItem.body && vItem.body.includes('Updated at ');
      record(`verify-update:${ID_A}`, !!updatedOk, updatedOk ? { len: vItem.body.length } : { vp });
    }

    // 4) KEYWORD SEARCH — must locate hummingbird entry
    {
      log('act', 'index_search keyword', { keywords: ['hummingbird'] });
      const resp = await mcp.callTool('index_search', { keywords: ['hummingbird'], mode: 'keyword', limit: 25 });
      const payload = parseToolPayload(resp);
      const ids = extractIds(payload);
      record('search-keyword:hummingbird', ids.includes(ID_A), { ids, payload });
    }
    {
      log('act', 'index_search keyword', { keywords: ['sonar'] });
      const resp = await mcp.callTool('index_search', { keywords: ['sonar'], mode: 'keyword', limit: 25 });
      const ids = extractIds(parseToolPayload(resp));
      record('search-keyword:sonar', ids.includes(ID_B), { ids });
    }

    // 4b) MULTI-KEYWORD AND SEMANTICS — both terms present in ID_D → found;
    //     searching for one term from ID_D plus a word NOT in ID_D → ID_D absent.
    {
      log('act', 'index_search multi-keyword AND', { keywords: ['pelican', 'mangrove'] });
      const resp = await mcp.callTool('index_search', { keywords: ['pelican', 'mangrove'], mode: 'keyword', limit: 25 });
      const ids = extractIds(parseToolPayload(resp));
      record('search-multi-keyword-AND:both-match', ids.includes(ID_D), { ids });
    }
    {
      // [gap-probe] 'pelican' is in ID_D; 'sonar' is NOT.
      // AND semantics would mean ID_D must be absent (only matches one keyword).
      // Server currently uses OR semantics → ID_D still appears (pelican matches).
      // If this step PASSES (ID_D absent), it means the server now enforces AND semantics → gap closed.
      log('act', 'index_search multi-keyword AND mismatch', { keywords: ['pelican', 'sonar'] });
      const resp = await mcp.callTool('index_search', { keywords: ['pelican', 'sonar'], mode: 'keyword', limit: 25 });
      const ids = extractIds(parseToolPayload(resp));
      record('search-multi-keyword-AND:partial-miss [gap-probe]', !ids.includes(ID_D), { ids, note: 'server uses OR semantics; ID_D found via pelican even when sonar absent — gap' });
    }

    // 5) SEMANTIC SEARCH — only if requested. Records the failure clearly when broken.
    if (!SKIP_SEMANTIC) {
      const semanticOn = (profileEnv.INDEX_SERVER_SEMANTIC_ENABLED || '0') === '1';
      if (!semanticOn) {
        log('info', 'semantic-skip', { reason: 'INDEX_SERVER_SEMANTIC_ENABLED != 1' });
      } else {
        // Use a query that's lexically distinct but semantically close to the espresso entry.
        log('act', 'index_search semantic', { keywords: ['coffee brewing'] });
        const resp = await mcp.callTool('index_search', { keywords: ['coffee brewing'], mode: 'semantic', limit: 25 }, 30000);
        const payload = parseToolPayload(resp);
        const ids = extractIds(payload);
        const ok = ids.includes(ID_C);
        record('search-semantic:coffee-brewing→espresso', ok, { ids, payload, error: resp?.error });
      }
    }

    // 6) DELETE + verify gone
    if (!KEEP) {
      log('act', 'index_remove', { ids: PROBE_IDS });
      const resp = await mcp.callTool('index_remove', { ids: PROBE_IDS, force: true });
      const payload = parseToolPayload(resp);
      record('remove', !resp?.error && (payload?.success !== false), { error: resp?.error, payload });

      for (const id of PROBE_IDS) {
        const v = await mcp.callTool('index_dispatch', { action: 'get', id });
        const vp = parseToolPayload(v);
        const item = vp?.item;
        const gone = !vp || vp.notFound || vp.error || (item && item.id !== id) || !item;
        record(`verify-deleted:${id}`, !!gone, { vp, error: v?.error });
      }

      // 6b) POST-DELETE SEARCH ABSENCE — deleted entries must not appear in index_search.
      //     A probe-entry appearing in search after deletion would indicate stale index state.
      {
        log('act', 'post-delete search absence check', { keywords: ['hummingbird'] });
        const resp = await mcp.callTool('index_search', { keywords: ['hummingbird'], mode: 'keyword', limit: 25 });
        const ids = extractIds(parseToolPayload(resp));
        record('post-delete:hummingbird-absent', !ids.includes(ID_A), { ids, note: 'ID_A must not appear after remove' });
      }
      {
        log('act', 'post-delete search absence check', { keywords: ['pelican'] });
        const resp = await mcp.callTool('index_search', { keywords: ['pelican'], mode: 'keyword', limit: 25 });
        const ids = extractIds(parseToolPayload(resp));
        record('post-delete:pelican-absent', !ids.includes(ID_D), { ids, note: 'ID_D must not appear after remove' });
      }
    } else {
      log('info', 'keep-flag', { reason: '--keep specified; entries left in sandbox', ids: PROBE_IDS });
    }
  } catch (e) {
    record('exception', false, { message: String(e?.message || e), stack: String(e?.stack || '').split('\n').slice(0, 6).join(' | ') });
  } finally {
    await mcp.close();
  }

  // Summary
  const summary = {
    total: results.length,
    passed: results.filter(r => r.ok).length,
    failed: failures,
    gapProbes: results.filter(r => r.name.includes('[gap-probe]')).length,
    gapProbesFailed: results.filter(r => r.name.includes('[gap-probe]') && !r.ok).length,
  };
  log(failures === 0 ? 'pass' : 'FAIL', 'probe-summary', summary);
  // Machine-readable summary on stdout
  process.stdout.write(JSON.stringify({ summary, results }, null, 2) + '\n');
  if (logSink) logSink.end();
  process.exit(failures === 0 ? 0 : 1);
})();

// ── helpers ────────────────────────────────────────────────────────────────
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
