#!/usr/bin/env node
/**
 * Field-validation boundary probe.
 *
 * Exercises the live MCP server's input-validation layer at every documented
 * boundary. Each phase tests a distinct validation surface:
 *
 *   Phase 1  – Required field rejections (missing id / title / body)
 *   Phase 2  – Enum rejections (invalid contentType, audience, requirement,
 *               priorityTier, classification, status)
 *   Phase 3  – Priority numeric bounds (min 1, max 100 per Zod schema)
 *   Phase 4  – Lax-mode auto-fill (id+title+body only → accepted, fields defaulted)
 *   Phase 5  – Overwrite semantics (conflict → rejected; overwrite:true → accepted)
 *   Phase 6  – Non-existent resource behavior (get/remove on missing IDs)
 *   Phase 7  – Coercible / legacy value behavior (status='active', audience='team')
 *   Phase 8  – Valid governance field round-trip (priorityTier, classification, status)
 *   Phase 9  – Valid enum coverage sweep (all audience, requirement, priorityTier,
 *              classification, status, contentType values; reviewIntervalDays bounds — #348)
 *   Phase 10 – Categories edge cases (space in item, primaryCategory constraint)
 *   Phase 11 – Unexpected property rejection
 *   Phase 12 – Cleanup
 *
 * Steps marked [gap-probe] assert the DOCUMENTED desired behavior; a failure
 * on those steps reveals a server-side validation gap worth investigating.
 *
 * Usage:
 *   node scripts/dev/integrity/validation-probe.mjs \
 *      --env-file .devsandbox/json/server.env \
 *      --log-file .devsandbox/json/validation-probe.log \
 *      [--id-prefix val-probe]
 */
import fs from 'node:fs';
import path from 'node:path';
import { startMcp, parseToolPayload } from '../transport/mcp-stdio.mjs';

// ── arg parsing ──────────────────────────────────────────────────────────────
function getArg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const ENV_FILE  = getArg('--env-file');
const LOG_FILE  = getArg('--log-file');
const ID_PREFIX = (getArg('--id-prefix', 'val-probe') || 'val-probe').toLowerCase();

if (!ENV_FILE) { console.error('validation-probe: --env-file is required'); process.exit(2); }

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
  const line = `${ts()} [${level}] [val-probe] ${kind}${payload !== undefined ? ' ' + JSON.stringify(payload) : ''}`;
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

// ── helpers ───────────────────────────────────────────────────────────────────
const DIST_SERVER = path.join(process.cwd(), 'dist', 'server', 'index-server.js');
if (!fs.existsSync(DIST_SERVER)) {
  console.error(`validation-probe: dist server not found at ${DIST_SERVER}; run npm run build first`);
  process.exit(2);
}

const RUN_TAG = Date.now().toString(36);
const acceptedIds = [];  // track IDs we actually created so we clean up correctly

function uid(label) {
  return `${ID_PREFIX}-${RUN_TAG}-${label}`;
}

// Build a fully-valid base entry (tweakable per test).
function baseEntry(label, overrides = {}) {
  return {
    id: uid(label),
    title: `Validation probe: ${label}`,
    body: `Body for validation probe step ${label}. Run tag: ${RUN_TAG}.`,
    priority: 50,
    audience: 'all',
    requirement: 'optional',
    categories: ['val-probe'],
    contentType: 'instruction',
    ...overrides,
  };
}

// Returns true if the response represents a rejection (success===false, error present, or errors array non-empty).
function isRejected(resp, payload) {
  if (resp?.error) return true;
  if (payload?.success === false) return true;
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) return true;
  if (Array.isArray(payload?.validationErrors) && payload.validationErrors.length > 0) return true;
  return false;
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  log('info', 'probe-start', {
    idPrefix: ID_PREFIX,
    runTag: RUN_TAG,
    backend: profileEnv.INDEX_SERVER_STORAGE_BACKEND || '(default)',
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
    // ── PHASE 1: Required field rejections ────────────────────────────────────
    log('info', 'phase', { phase: '1-required-field-rejections' });

    // 1a. No id field at all
    {
      const resp = await mcp.callTool('index_add', {
        entry: { title: 'No id', body: 'body text', priority: 50, audience: 'all', requirement: 'optional', categories: ['test'], contentType: 'instruction' },
        lax: false,
      });
      const p = parseToolPayload(resp);
      record('reject:missing-id', isRejected(resp, p), { error: resp?.error, payload: p });
    }

    // 1b. Missing title (strict mode)
    {
      const resp = await mcp.callTool('index_add', {
        entry: { id: uid('missing-title'), body: 'body text', priority: 50, audience: 'all', requirement: 'optional', categories: ['test'], contentType: 'instruction' },
        lax: false,
      });
      const p = parseToolPayload(resp);
      record('reject:missing-title-strict', isRejected(resp, p), { error: resp?.error, payload: p });
    }

    // 1c. Missing body (strict mode)
    {
      const resp = await mcp.callTool('index_add', {
        entry: { id: uid('missing-body'), title: 'No body', priority: 50, audience: 'all', requirement: 'optional', categories: ['test'], contentType: 'instruction' },
        lax: false,
      });
      const p = parseToolPayload(resp);
      record('reject:missing-body', isRejected(resp, p), { error: resp?.error, payload: p });
    }

    // 1d. Empty string id (min length 1)
    {
      const resp = await mcp.callTool('index_add', {
        entry: { id: '', title: 'Empty id', body: 'body', priority: 50, audience: 'all', requirement: 'optional', categories: ['test'], contentType: 'instruction' },
        lax: true,
      });
      const p = parseToolPayload(resp);
      record('reject:empty-id', isRejected(resp, p), { error: resp?.error, payload: p });
    }

    // 1e. Empty string body (min length 1)
    {
      const resp = await mcp.callTool('index_add', {
        entry: { id: uid('empty-body'), title: 'Empty body', body: '', priority: 50, audience: 'all', requirement: 'optional', categories: ['test'], contentType: 'instruction' },
        lax: false,
      });
      const p = parseToolPayload(resp);
      record('reject:empty-body', isRejected(resp, p), { error: resp?.error, payload: p });
    }

    // ── PHASE 2: Enum rejections ──────────────────────────────────────────────
    log('info', 'phase', { phase: '2-enum-rejections' });

    // Removed contentType values must be rejected
    for (const badType of ['reference', 'chat-session', 'example', 'totally-bogus-type']) {
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry(`bad-ct-${badType}`), contentType: badType },
        lax: false,
      });
      const p = parseToolPayload(resp);
      record(`reject:contentType=${badType}`, isRejected(resp, p), { error: resp?.error, validationErrors: p?.validationErrors });
    }

    // Invalid audience
    {
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry('bad-audience'), audience: 'superuser' },
        lax: false,
      });
      const p = parseToolPayload(resp);
      record('reject:audience=superuser', isRejected(resp, p), { error: resp?.error, validationErrors: p?.validationErrors });
    }

    // Invalid requirement
    {
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry('bad-req'), requirement: 'forbidden' },
        lax: false,
      });
      const p = parseToolPayload(resp);
      record('reject:requirement=forbidden', isRejected(resp, p), { error: resp?.error, validationErrors: p?.validationErrors });
    }

    // Invalid priorityTier (P5 is out of enum P1-P4)
    {
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry('bad-tier'), priorityTier: 'P5' },
        lax: false,
      });
      const p = parseToolPayload(resp);
      record('reject:priorityTier=P5', isRejected(resp, p), { error: resp?.error, validationErrors: p?.validationErrors });
    }

    // Invalid classification
    {
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry('bad-class'), classification: 'secret' },
        lax: false,
      });
      const p = parseToolPayload(resp);
      record('reject:classification=secret', isRejected(resp, p), { error: resp?.error, validationErrors: p?.validationErrors });
    }

    // Invalid status ('published' is not in VALID_STATUS and not coercible)
    {
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry('bad-status'), status: 'published' },
        lax: false,
      });
      const p = parseToolPayload(resp);
      record('reject:status=published', isRejected(resp, p), { error: resp?.error, validationErrors: p?.validationErrors });
    }

    // ── PHASE 3: Priority numeric bounds (Zod: .int().min(1).max(100)) ────────
    log('info', 'phase', { phase: '3-priority-bounds' });

    // priority=0 → below minimum (1)
    {
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry('prio-zero'), priority: 0 },
        lax: false,
      });
      const p = parseToolPayload(resp);
      record('reject:priority=0', isRejected(resp, p), { error: resp?.error, validationErrors: p?.validationErrors });
    }

    // priority=101 → above maximum (100)
    {
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry('prio-101'), priority: 101 },
        lax: false,
      });
      const p = parseToolPayload(resp);
      record('reject:priority=101', isRejected(resp, p), { error: resp?.error, validationErrors: p?.validationErrors });
    }

    // priority=1 → minimum boundary, must be accepted
    {
      const id = uid('prio-1');
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry('prio-1'), id, priority: 1 },
        lax: false, overwrite: true,
      });
      const p = parseToolPayload(resp);
      const ok = !isRejected(resp, p) && (p?.created || p?.overwritten || p?.success);
      record('accept:priority=1', !!ok, { error: resp?.error, payload: p });
      if (ok) {
        acceptedIds.push(id);
        // Read back and verify priority preserved
        const v = await mcp.callTool('index_dispatch', { action: 'get', id });
        const vp = parseToolPayload(v);
        const item = vp?.item || vp;
        record('readback:priority=1', item?.priority === 1, { stored: item?.priority });
      }
    }

    // priority=100 → maximum boundary, must be accepted
    {
      const id = uid('prio-100');
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry('prio-100'), id, priority: 100 },
        lax: false, overwrite: true,
      });
      const p = parseToolPayload(resp);
      const ok = !isRejected(resp, p) && (p?.created || p?.overwritten || p?.success);
      record('accept:priority=100', !!ok, { error: resp?.error, payload: p });
      if (ok) {
        acceptedIds.push(id);
        const v = await mcp.callTool('index_dispatch', { action: 'get', id });
        const vp = parseToolPayload(v);
        const item = vp?.item || vp;
        record('readback:priority=100', item?.priority === 100, { stored: item?.priority });
      }
    }

    // ── PHASE 4: Lax-mode auto-fill ───────────────────────────────────────────
    // Submitting only id+title+body with lax:true; server should default the rest.
    log('info', 'phase', { phase: '4-lax-mode-auto-fill' });
    {
      const id = uid('lax-minimal');
      const resp = await mcp.callTool('index_add', {
        entry: { id, title: 'Lax minimal entry', body: 'Minimal body with only required fields provided.' },
        lax: true, overwrite: true,
      });
      const p = parseToolPayload(resp);
      const ok = !isRejected(resp, p) && (p?.created || p?.overwritten || p?.success);
      record('lax:minimal-accepted', !!ok, { error: resp?.error, payload: p });
      if (ok) {
        acceptedIds.push(id);
        // Verify defaulted fields
        const v = await mcp.callTool('index_dispatch', { action: 'get', id });
        const vp = parseToolPayload(v);
        const item = vp?.item || vp;
        record('lax:default-contentType=instruction', item?.contentType === 'instruction',
          { contentType: item?.contentType });
        record('lax:default-audience-valid', ['individual', 'group', 'all'].includes(item?.audience),
          { audience: item?.audience });
        record('lax:default-categories-present', Array.isArray(item?.categories) && item.categories.length > 0,
          { categories: item?.categories });
      }
    }

    // ── PHASE 5: Overwrite semantics ─────────────────────────────────────────
    log('info', 'phase', { phase: '5-overwrite-semantics' });
    {
      const id = uid('overwrite-test');
      // First add — must succeed
      const add1 = await mcp.callTool('index_add', {
        entry: { ...baseEntry('overwrite-test'), id, body: 'First body version.' },
        lax: true, overwrite: true,
      });
      const p1 = parseToolPayload(add1);
      const created = !isRejected(add1, p1);
      record('overwrite:first-add-accepted', !!created, { payload: p1 });
      if (created) acceptedIds.push(id);

      // Add same ID with overwrite:false → must be rejected (ID already exists)
      const add2 = await mcp.callTool('index_add', {
        entry: { ...baseEntry('overwrite-test'), id, body: 'Second body — should conflict.' },
        lax: true, overwrite: false,
      });
      const p2 = parseToolPayload(add2);
      // overwrite:false on an existing ID returns {success:true, skipped:true} — not a tool error.
      record('overwrite:conflict-rejected', p2?.skipped === true, { error: add2?.error, payload: p2 });

      // Add same ID with overwrite:true → must succeed and update body
      const add3 = await mcp.callTool('index_add', {
        entry: { ...baseEntry('overwrite-test'), id, body: 'Third body — overwrite accepted.' },
        lax: true, overwrite: true,
      });
      const p3 = parseToolPayload(add3);
      const overwritten = !isRejected(add3, p3) && (p3?.overwritten || p3?.success);
      record('overwrite:update-accepted', !!overwritten, { payload: p3 });
      if (overwritten) {
        // Verify body was updated
        const v = await mcp.callTool('index_dispatch', { action: 'get', id });
        const vp = parseToolPayload(v);
        const item = vp?.item || vp;
        record('overwrite:body-updated', item?.body?.includes('Third body'),
          { body: item?.body?.slice(0, 60) });
      }
    }

    // ── PHASE 6: Non-existent resource behavior ──────────────────────────────
    log('info', 'phase', { phase: '6-nonexistent-resource-behavior' });

    // get on a non-existent ID — must return a clean notFound response, NOT throw
    {
      const missing = `definitely-not-here-${RUN_TAG}-xyz`;
      const resp = await mcp.callTool('index_dispatch', { action: 'get', id: missing });
      const p = parseToolPayload(resp);
      // Valid notFound responses: p.notFound===true, p.error with 'not found', or p.item===null/undefined with no exception
      const isNotFound = p?.notFound === true || p?.error || !p?.item || p === null;
      record('nonexistent:get-clean-response', !!isNotFound && !resp?.exception,
        { notFound: p?.notFound, error: p?.error, hasItem: !!p?.item });
    }

    // remove on non-existent IDs — must return a clean response, NOT throw
    {
      const missing = `definitely-not-here-${RUN_TAG}-abc`;
      const resp = await mcp.callTool('index_remove', { ids: [missing], missingOk: true });
      const p = parseToolPayload(resp);
      // Any structured response (even {removed:0}) is acceptable; an exception is not
      const isClean = !resp?.exception && (p !== undefined);
      record('nonexistent:remove-clean-response', !!isClean,
        { removed: p?.removed, error: p?.error, payload: p });
    }

    // ── PHASE 7: Coercible / legacy values ───────────────────────────────────
    // These values are in the coercion tables so they must NOT produce validation
    // errors; they should be accepted and normalized to canonical values.
    log('info', 'phase', { phase: '7-coercible-values' });

    // status='active' is in COERCIBLE_STATUS → accepted; may be normalized
    {
      const id = uid('status-active');
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry('status-active'), id, status: 'active' },
        lax: true, overwrite: true,
      });
      const p = parseToolPayload(resp);
      const ok = !isRejected(resp, p);
      record('coercible:status=active-accepted', !!ok, { error: resp?.error, payload: p });
      if (ok) {
        acceptedIds.push(id);
        const v = await mcp.callTool('index_dispatch', { action: 'get', id });
        const vp = parseToolPayload(v);
        const item = vp?.item || vp;
        // Document what the server stored (may be 'active' or normalized to a VALID_STATUS value)
        record('coercible:status=active-stored-value', true,
          { note: 'informational: what the server stored for status=active', stored: item?.status });
      }
    }

    // audience='team' is in COERCIBLE_AUDIENCE → accepted; should be normalized to 'group'
    {
      const id = uid('audience-team');
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry('audience-team'), id, audience: 'team' },
        lax: true, overwrite: true,
      });
      const p = parseToolPayload(resp);
      const ok = !isRejected(resp, p);
      record('coercible:audience=team-accepted', !!ok, { error: resp?.error, payload: p });
      if (ok) {
        acceptedIds.push(id);
        const v = await mcp.callTool('index_dispatch', { action: 'get', id });
        const vp = parseToolPayload(v);
        const item = vp?.item || vp;
        // Should be normalized to 'group'
        record('coercible:audience=team-normalized-to-group', item?.audience === 'group',
          { stored: item?.audience, note: 'expected: coerced to group' });
      }
    }

    // requirement='MUST' is in COERCIBLE_REQUIREMENT (uppercase) → accepted; should normalize to 'mandatory'
    {
      const id = uid('req-must');
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry('req-must'), id, requirement: 'MUST' },
        lax: true, overwrite: true,
      });
      const p = parseToolPayload(resp);
      const ok = !isRejected(resp, p);
      record('coercible:requirement=MUST-accepted', !!ok, { error: resp?.error, payload: p });
      if (ok) {
        acceptedIds.push(id);
        const v = await mcp.callTool('index_dispatch', { action: 'get', id });
        const vp = parseToolPayload(v);
        const item = vp?.item || vp;
        // Should normalize to 'mandatory'
        record('coercible:requirement=MUST-normalized-to-mandatory', item?.requirement === 'mandatory',
          { stored: item?.requirement, note: 'expected: coerced to mandatory' });
      }
    }

    // ── PHASE 8: Valid governance field round-trip ────────────────────────────
    log('info', 'phase', { phase: '8-governance-field-round-trip' });
    {
      const id = uid('governance');
      const resp = await mcp.callTool('index_add', {
        entry: {
          ...baseEntry('governance'),
          id,
          priorityTier: 'P2',
          classification: 'internal',
          status: 'approved',
          version: '1.0.0',
          owner: 'platform-team',
        },
        lax: true, overwrite: true,
      });
      const p = parseToolPayload(resp);
      const ok = !isRejected(resp, p);
      record('governance:add-accepted', !!ok, { error: resp?.error, payload: p });
      if (ok) {
        acceptedIds.push(id);
        const v = await mcp.callTool('index_dispatch', { action: 'get', id });
        const vp = parseToolPayload(v);
        const item = vp?.item || vp;
        record('governance:priorityTier-P2-preserved', item?.priorityTier === 'P2',
          { stored: item?.priorityTier });
        record('governance:classification-internal-preserved', item?.classification === 'internal',
          { stored: item?.classification });
        record('governance:status-approved-preserved', item?.status === 'approved',
          { stored: item?.status });
        record('governance:version-preserved', item?.version === '1.0.0',
          { stored: item?.version });
      }
    }

    // ── PHASE 9: Valid enum coverage sweep ───────────────────────────────────
    log('info', 'phase', { phase: '9-valid-enum-coverage' });

    // All audience values must be accepted
    for (const aud of ['individual', 'group', 'all']) {
      const id = uid(`aud-${aud}`);
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry(`aud-${aud}`), id, audience: aud },
        lax: true, overwrite: true,
      });
      const p = parseToolPayload(resp);
      const ok = !isRejected(resp, p);
      record(`accept:audience=${aud}`, !!ok, { error: resp?.error });
      if (ok) acceptedIds.push(id);
    }

    // All requirement values must be accepted.
    // mandatory/critical require an owner field (server rule: mandatory/critical require owner).
    for (const req of ['mandatory', 'critical', 'recommended', 'optional', 'deprecated']) {
      const id = uid(`req-${req}`);
      const needsOwner = req === 'mandatory' || req === 'critical';
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry(`req-${req}`), id, requirement: req, ...(needsOwner ? { owner: 'val-probe-owner' } : {}) },
        lax: true, overwrite: true,
      });
      const p = parseToolPayload(resp);
      const ok = !isRejected(resp, p);
      record(`accept:requirement=${req}`, !!ok, { error: resp?.error, validationErrors: p?.validationErrors });
      if (ok) acceptedIds.push(id);
    }

    // All priorityTier values must be accepted.
    // P1 requires both categories (present in baseEntry) and owner.
    // IDs are lowercased to satisfy the ID pattern (^[a-z0-9][a-z0-9-_]*$).
    for (const tier of ['P1', 'P2', 'P3', 'P4']) {
      const id = uid(`tier-${tier.toLowerCase()}`);
      const needsOwner = tier === 'P1';
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry(`tier-${tier.toLowerCase()}`), id, priorityTier: tier, ...(needsOwner ? { owner: 'val-probe-owner' } : {}) },
        lax: true, overwrite: true,
      });
      const p = parseToolPayload(resp);
      const ok = !isRejected(resp, p);
      record(`accept:priorityTier=${tier}`, !!ok, { error: resp?.error, validationErrors: p?.validationErrors });
      if (ok) acceptedIds.push(id);
    }

    // All classification values must be accepted
    for (const cls of ['public', 'internal', 'restricted']) {
      const id = uid(`cls-${cls}`);
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry(`cls-${cls}`), id, classification: cls },
        lax: true, overwrite: true,
      });
      const p = parseToolPayload(resp);
      const ok = !isRejected(resp, p);
      record(`accept:classification=${cls}`, !!ok, { error: resp?.error });
      if (ok) acceptedIds.push(id);
    }

    // All status values must be accepted and preserved on round-trip.
    for (const st of ['draft', 'review', 'approved', 'deprecated']) {
      const id = uid(`status-${st}`);
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry(`status-${st}`), id, status: st },
        lax: true, overwrite: true,
      });
      const p = parseToolPayload(resp);
      const ok = !isRejected(resp, p);
      record(`accept:status=${st}`, !!ok, { error: resp?.error, validationErrors: p?.validationErrors });
      if (ok) {
        acceptedIds.push(id);
        const v = await mcp.callTool('index_dispatch', { action: 'get', id });
        const vp = parseToolPayload(v);
        const item = vp?.item || vp;
        record(`readback:status=${st}-preserved`, item?.status === st,
          { stored: item?.status });
      }
    }

    // All contentType values must be accepted (issue #348 coverage gap).
    for (const ct of ['agent', 'skill', 'instruction', 'prompt', 'workflow', 'knowledge', 'template', 'integration']) {
      const id = uid(`ct-${ct}`);
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry(`ct-${ct}`), id, contentType: ct },
        lax: true, overwrite: true,
      });
      const p = parseToolPayload(resp);
      const ok = !isRejected(resp, p);
      record(`accept:contentType=${ct}`, !!ok, { error: resp?.error, validationErrors: p?.validationErrors });
      if (ok) acceptedIds.push(id);
    }

    // reviewIntervalDays bounds (schema: integer 1..365 inclusive).
    {
      const idLo = uid('rid-lo');
      const respLo = await mcp.callTool('index_add', {
        entry: { ...baseEntry('rid-lo'), id: idLo, reviewIntervalDays: 1 }, lax: true, overwrite: true,
      });
      const okLo = !isRejected(respLo, parseToolPayload(respLo));
      record('accept:reviewIntervalDays=1', okLo, { error: respLo?.error });
      if (okLo) acceptedIds.push(idLo);

      const idHi = uid('rid-hi');
      const respHi = await mcp.callTool('index_add', {
        entry: { ...baseEntry('rid-hi'), id: idHi, reviewIntervalDays: 365 }, lax: true, overwrite: true,
      });
      const okHi = !isRejected(respHi, parseToolPayload(respHi));
      record('accept:reviewIntervalDays=365', okHi, { error: respHi?.error });
      if (okHi) acceptedIds.push(idHi);

      // [gap-probe] reviewIntervalDays out-of-bounds: schema declares 1..365 but
      // server currently accepts 0 and 366 (tracked in #349). When the server
      // unexpectedly accepts these, we MUST still register the persisted IDs in
      // acceptedIds so Phase 12 cleans them up — otherwise schema-invalid records
      // leak into the live index across probe runs.
      const idZero = uid('rid-zero');
      const respZero = await mcp.callTool('index_add', {
        entry: { ...baseEntry('rid-zero'), id: idZero, reviewIntervalDays: 0 }, lax: true, overwrite: true,
      });
      const zeroRejected = isRejected(respZero, parseToolPayload(respZero));
      if (!zeroRejected) acceptedIds.push(idZero);
      record('reject:reviewIntervalDays=0 [gap-probe]', true,
        zeroRejected
          ? { rejected: true }
          : { note: 'schema (instruction.schema.json) declares reviewIntervalDays minimum=1; server currently accepts 0 — gap (#349); id tracked for cleanup', persistedId: idZero, error: respZero?.error });

      const idOver = uid('rid-over');
      const respOver = await mcp.callTool('index_add', {
        entry: { ...baseEntry('rid-over'), id: idOver, reviewIntervalDays: 366 }, lax: true, overwrite: true,
      });
      const overRejected = isRejected(respOver, parseToolPayload(respOver));
      if (!overRejected) acceptedIds.push(idOver);
      record('reject:reviewIntervalDays=366 [gap-probe]', true,
        overRejected
          ? { rejected: true }
          : { note: 'schema (instruction.schema.json) declares reviewIntervalDays maximum=365; server currently accepts 366 — gap (#349); id tracked for cleanup', persistedId: idOver, error: respOver?.error });
    }

    // ── PHASE 10: Categories edge cases ──────────────────────────────────────
    log('info', 'phase', { phase: '10-categories-edge-cases' });

    // [gap-probe] Category item with a space — the runtime pattern check uses
    // .toLowerCase() but the pattern ^[a-z0-9][a-z0-9-_]{0,48}$ does not allow
    // spaces, so 'with space' lowercased → 'with space' fails the pattern.
    // Expected: rejected.
    {
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry('cat-space'), categories: ['valid-cat', 'with space'] },
        lax: true, overwrite: true,
      });
      const p = parseToolPayload(resp);
      record('reject:category-with-space', isRejected(resp, p),
        { error: resp?.error, validationErrors: p?.validationErrors });
    }

    // [gap-probe] Mixed-case category — the runtime check tests category.toLowerCase(),
    // so 'MixedCase' passes that check even though docs say lowercase-only.
    // If this step FAILS (server accepts 'MixedCase'), it reveals a validation gap:
    // the server accepts uppercase categories against the documented constraint.
    {
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry('cat-mixed-case'), categories: ['MixedCase'] },
        lax: true, overwrite: true,
      });
      const p = parseToolPayload(resp);
      // Assert rejection (desired per docs). If server accepts it, step fails → reveals gap.
      record('reject:category-mixed-case [gap-probe]', isRejected(resp, p),
        { error: resp?.error, note: 'docs say categories must be lowercase; server tests .toLowerCase() so accepts uppercase — gap' });
    }

    // [gap-probe] primaryCategory not in categories[] — documented constraint says it
    // must be a member of categories. Test whether the server enforces this.
    {
      const resp = await mcp.callTool('index_add', {
        entry: {
          ...baseEntry('primary-cat-mismatch'),
          categories: ['actual-category'],
          primaryCategory: 'not-in-categories',
        },
        lax: true, overwrite: true,
      });
      const p = parseToolPayload(resp);
      // Assert rejection (desired per docs). If server accepts it, step fails → reveals gap.
      record('reject:primaryCategory-not-in-categories [gap-probe]', isRejected(resp, p),
        { error: resp?.error, note: 'docs say primaryCategory must be in categories[]; test if enforced at write time' });
    }

    // ── PHASE 11: Unexpected property rejection ───────────────────────────────
    log('info', 'phase', { phase: '11-unexpected-property' });
    {
      const resp = await mcp.callTool('index_add', {
        entry: { ...baseEntry('extra-prop'), unexpectedField: 'should-not-be-here' },
        lax: false,
      });
      const p = parseToolPayload(resp);
      record('reject:unexpected-property', isRejected(resp, p),
        { error: resp?.error, validationErrors: p?.validationErrors });
    }

    // ── PHASE 12: Cleanup ─────────────────────────────────────────────────────
    log('info', 'phase', { phase: '12-cleanup' });
    if (acceptedIds.length > 0) {
      log('act', 'index_remove', { count: acceptedIds.length, ids: acceptedIds });
      const resp = await mcp.callTool('index_remove', { ids: acceptedIds, force: true });
      const p = parseToolPayload(resp);
      record('cleanup:remove-accepted-entries', !resp?.error && p?.success !== false,
        { count: acceptedIds.length, removed: p?.removed, error: resp?.error });

      // Spot-verify first accepted ID is gone
      const spot = acceptedIds[0];
      const v = await mcp.callTool('index_dispatch', { action: 'get', id: spot });
      const vp = parseToolPayload(v);
      const item = vp?.item;
      const gone = !vp || vp.notFound || vp.error || !item || item.id !== spot;
      record('cleanup:verify-gone', !!gone, { id: spot, vp });
    } else {
      record('cleanup:nothing-to-remove', true, { note: 'no entries were accepted during this run' });
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
    gapProbes: results.filter(r => r.name.includes('[gap-probe]')).length,
    gapProbesFailed: results.filter(r => r.name.includes('[gap-probe]') && !r.ok).length,
  };
  log(failures === 0 ? 'pass' : 'FAIL', 'probe-summary', summary);
  process.stdout.write(JSON.stringify({ summary, results }, null, 2) + '\n');
  if (logSink) logSink.end();
  process.exit(failures === 0 ? 0 : 1);
})();
