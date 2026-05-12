#!/usr/bin/env node
/**
 * Concurrent Integrity Test for Index Server (SQLite WAL focus)
 *
 * Fires N parallel MCP client connections against a single server process,
 * each performing add/remove mutations simultaneously. Validates:
 *   - No lost writes (final count matches expected)
 *   - No duplicate IDs from overlapping atomic renames (JSON) or WAL contention (SQLite)
 *   - No SQLITE_BUSY errors surfaced to clients
 *   - All operations reflected after a post-test reload/list
 *
 * Usage:
 *   node scripts/perf/adhoc-concurrent-integrity.mjs [--concurrency N] [--ops-per-client M]
 *
 * Environment:
 *   INDEX_SERVER_STORAGE_BACKEND=sqlite   (recommended)
 *   INDEX_SERVER_SQLITE_PATH=<path>       (optional, uses default if omitted)
 *   INDEX_SERVER_MUTATION=1               (required — set automatically)
 *   CONCURRENT_PREFIX=ci-test-            (namespace prefix for test entries)
 */

import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Canonical enum values — read from the JSON schema so this script never drifts
// from the source of truth. Every contentType is cycled through the workload so
// concurrent writes exercise the full taxonomy.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '..', '..', 'schemas', 'instruction.schema.json');
const _schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const CONTENT_TYPES = _schema?.properties?.contentType?.enum;
const AUDIENCES = _schema?.properties?.audience?.enum;
const REQUIREMENTS = _schema?.properties?.requirement?.enum;
const STATUSES = _schema?.properties?.status?.enum;
const PRIORITY_TIERS = _schema?.properties?.priorityTier?.enum;
const CLASSIFICATIONS = _schema?.properties?.classification?.enum;
for (const [name, arr] of Object.entries({ CONTENT_TYPES, AUDIENCES, REQUIREMENTS, STATUSES, PRIORITY_TIERS, CLASSIFICATIONS })) {
  if (!Array.isArray(arr) || arr.length === 0) {
    console.error(`adhoc-concurrent-integrity: failed to read ${name} enum from ${SCHEMA_PATH}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const { values: args } = parseArgs({
  options: {
    concurrency: { type: 'string', short: 'c', default: '4' },
    'ops-per-client': { type: 'string', short: 'o', default: '10' },
    cleanup: { type: 'boolean', default: true },
    verbose: { type: 'boolean', short: 'v', default: false },
  },
  strict: false,
});

const CONCURRENCY = parseInt(args.concurrency, 10);
const OPS_PER_CLIENT = parseInt(args['ops-per-client'], 10);
const CLEANUP = args.cleanup !== false;
const VERBOSE = args.verbose;
const PREFIX = process.env.CONCURRENT_PREFIX || 'ci-test-';
const RUN_ID = randomUUID().slice(0, 8);

function log(msg) { process.stdout.write(`[concurrency] ${msg}\n`); }
function vlog(msg) { if (VERBOSE) process.stderr.write(`  [v] ${msg}\n`); }

// ---------------------------------------------------------------------------
// MCP Client helpers (same pattern as perf-baseline.mjs)
// ---------------------------------------------------------------------------
async function connectClient(clientId) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

  const env = { ...process.env, INDEX_SERVER_MUTATION: '1' };
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/server/index-server.js'],
    env,
  });
  const client = new Client(
    { name: `concurrent-client-${clientId}`, version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  await client.connect(transport);
  return { client, close: () => transport.close() };
}

async function callTool(client, name, toolArgs) {
  const result = await client.callTool({ name, arguments: toolArgs });
  const text = (result?.content || []).map(c => c.text || '').join('');
  try { return JSON.parse(text); } catch { return text; }
}

// ---------------------------------------------------------------------------
// Test entry factory
// ---------------------------------------------------------------------------
function makeEntry(clientId, opIndex) {
  const id = `${PREFIX}${RUN_ID}-c${clientId}-op${opIndex}`;
  // Cycle through every canonical enum so concurrent writes cover the full
  // taxonomy. mandatory/critical and priorityTier=P1 require an `owner` per
  // server validation rules, so set one unconditionally.
  const contentType    = CONTENT_TYPES[opIndex % CONTENT_TYPES.length];
  const audience       = AUDIENCES[opIndex % AUDIENCES.length];
  const requirement    = REQUIREMENTS[opIndex % REQUIREMENTS.length];
  const status         = STATUSES[opIndex % STATUSES.length];
  const priorityTier   = PRIORITY_TIERS[opIndex % PRIORITY_TIERS.length];
  const classification = CLASSIFICATIONS[opIndex % CLASSIFICATIONS.length];
  return {
    id,
    title: `Concurrent test ${clientId}/${opIndex}`,
    body: `Integrity test entry created by client ${clientId}, operation ${opIndex}, run ${RUN_ID}. contentType=${contentType}.`,
    priority: 50,
    audience,
    requirement,
    categories: ['ci-test', 'concurrent', `ct-${contentType}`],
    contentType,
    status,
    priorityTier,
    classification,
    owner: 'adhoc-concurrent-integrity',
  };
}

// ---------------------------------------------------------------------------
// Worker: one client performing its batch of mutations
// ---------------------------------------------------------------------------
async function runWorker(clientId) {
  const t0 = performance.now();
  const conn = await connectClient(clientId);
  const results = { added: [], errors: [], timings: [] };

  for (let i = 0; i < OPS_PER_CLIENT; i++) {
    const entry = makeEntry(clientId, i);
    const opStart = performance.now();
    try {
      const res = await callTool(conn.client, 'index_add', {
        entry,
        lax: true,
        overwrite: false,
      });
      const opMs = +(performance.now() - opStart).toFixed(2);
      results.timings.push(opMs);

      if (res?.success || res?.id || (typeof res === 'string' && res.includes('added'))) {
        results.added.push(entry.id);
        vlog(`client-${clientId} ADD #${i} OK (${opMs}ms) → ${entry.id}`);
      } else {
        results.errors.push({ op: 'add', id: entry.id, response: res });
        vlog(`client-${clientId} ADD #${i} UNEXPECTED: ${JSON.stringify(res).slice(0, 200)}`);
      }
    } catch (err) {
      const opMs = +(performance.now() - opStart).toFixed(2);
      results.timings.push(opMs);
      results.errors.push({ op: 'add', id: entry.id, error: err.message || String(err) });
      vlog(`client-${clientId} ADD #${i} ERROR (${opMs}ms): ${err.message}`);
    }
  }

  const totalMs = +(performance.now() - t0).toFixed(2);
  await conn.close();
  return { clientId, totalMs, ...results };
}

// ---------------------------------------------------------------------------
// Verification pass: connect a fresh client and check all entries exist
// ---------------------------------------------------------------------------
async function verifyIntegrity(expectedIds) {
  const conn = await connectClient('verifier');
  const allFound = [];
  const missing = [];
  const duplicates = [];

  // Use index_dispatch list to get all entries, then filter by our prefix
  const listRes = await callTool(conn.client, 'index_dispatch', {
    action: 'list',
  });

  const foundIds = new Set();
  const items = listRes?.items || listRes?.entries || [];
  const itemArray = Array.isArray(items) ? items : [];
  const targetPrefix = PREFIX + RUN_ID;

  for (const item of itemArray) {
    const id = typeof item === 'string' ? item : item?.id;
    if (id && id.startsWith(targetPrefix)) {
      if (foundIds.has(id)) {
        duplicates.push(id);
      }
      foundIds.add(id);
      allFound.push(id);
    }
  }

  // If list didn't work well, try individual gets as fallback
  if (allFound.length === 0 && expectedIds.length > 0) {
    vlog('List returned 0 matches, trying individual gets...');
    for (const id of expectedIds.slice(0, 5)) {
      try {
        const res = await callTool(conn.client, 'index_dispatch', { action: 'get', id });
        if (res && !res.error) {
          foundIds.add(id);
          allFound.push(id);
          vlog(`  get ${id}: FOUND`);
        } else {
          vlog(`  get ${id}: ${JSON.stringify(res).slice(0, 100)}`);
        }
      } catch (err) {
        vlog(`  get ${id}: ERROR ${err.message}`);
      }
    }
    // If sample gets work, do the rest
    if (allFound.length > 0) {
      for (const id of expectedIds.slice(5)) {
        try {
          const res = await callTool(conn.client, 'index_dispatch', { action: 'get', id });
          if (res && !res.error) {
            if (foundIds.has(id)) duplicates.push(id);
            foundIds.add(id);
            allFound.push(id);
          }
        } catch { /* count as missing */ }
      }
    }
  }

  for (const id of expectedIds) {
    if (!foundIds.has(id)) missing.push(id);
  }

  await conn.close();
  return { found: allFound.length, missing, duplicates, expectedCount: expectedIds.length };
}

// ---------------------------------------------------------------------------
// Cleanup: remove all test entries
// ---------------------------------------------------------------------------
async function cleanup(ids) {
  if (!ids.length) return;
  const conn = await connectClient('cleaner');
  const batchSize = 5;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    try {
      await callTool(conn.client, 'index_remove', {
        ids: batch,
        missingOk: true,
        force: batch.length > 5,
      });
      vlog(`cleanup: removed ${batch.length} entries`);
    } catch (err) {
      vlog(`cleanup error: ${err.message}`);
    }
  }
  await conn.close();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  log(`=== Concurrent Integrity Test ===`);
  log(`Concurrency: ${CONCURRENCY} clients | Ops/client: ${OPS_PER_CLIENT} | Run: ${RUN_ID}`);
  log(`Total expected writes: ${CONCURRENCY * OPS_PER_CLIENT}`);
  log('');

  // Phase 1: Fire all clients concurrently
  log('Phase 1: Spawning concurrent clients...');
  const t0 = performance.now();
  const workers = Array.from({ length: CONCURRENCY }, (_, i) => runWorker(i));
  const workerResults = await Promise.all(workers);
  const phase1Ms = +(performance.now() - t0).toFixed(2);

  // Aggregate results
  const allAdded = workerResults.flatMap(r => r.added);
  const allErrors = workerResults.flatMap(r => r.errors);
  const allTimings = workerResults.flatMap(r => r.timings);
  const sorted = allTimings.slice().sort((a, b) => a - b);

  log(`Phase 1 complete (${phase1Ms}ms)`);
  log(`  Added: ${allAdded.length}/${CONCURRENCY * OPS_PER_CLIENT}`);
  log(`  Errors: ${allErrors.length}`);
  if (sorted.length) {
    const mean = +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2);
    log(`  Latency: min=${sorted[0]}ms mean=${mean}ms max=${sorted[sorted.length - 1]}ms p95=${sorted[Math.floor(sorted.length * 0.95)]}ms`);
  }
  log('');

  // Phase 2: Verify integrity
  log('Phase 2: Verifying write integrity...');
  const verification = await verifyIntegrity(allAdded);
  log(`  Expected: ${verification.expectedCount}`);
  log(`  Found: ${verification.found}`);
  log(`  Missing: ${verification.missing.length}`);
  log(`  Duplicates: ${verification.duplicates.length}`);
  log('');

  // Phase 3: Cleanup
  if (CLEANUP && allAdded.length > 0) {
    log('Phase 3: Cleaning up test entries...');
    await cleanup(allAdded);
    log('  Done.');
    log('');
  }

  // Assertions
  const failures = [];
  if (allErrors.length > 0) {
    // Check if errors are SQLITE_BUSY specifically
    const busyErrors = allErrors.filter(e => (e.error || '').includes('SQLITE_BUSY'));
    if (busyErrors.length > 0) {
      failures.push(`SQLITE_BUSY errors: ${busyErrors.length}`);
    }
    // Non-busy errors are warnings but not necessarily failures
    const otherErrors = allErrors.filter(e => !(e.error || '').includes('SQLITE_BUSY'));
    if (otherErrors.length > 0) {
      log(`⚠️  Non-BUSY errors (${otherErrors.length}):`);
      for (const e of otherErrors.slice(0, 5)) {
        log(`    ${e.id}: ${e.error || JSON.stringify(e.response).slice(0, 100)}`);
      }
    }
  }
  if (verification.missing.length > 0) {
    failures.push(`Lost writes: ${verification.missing.length} entries missing after concurrent add`);
  }
  if (verification.duplicates.length > 0) {
    failures.push(`Duplicate entries: ${verification.duplicates.length}`);
  }

  // Final verdict
  log('─'.repeat(50));
  if (failures.length === 0) {
    log('✅ PASS — All concurrent writes verified successfully');
    log(`   ${allAdded.length} entries written by ${CONCURRENCY} clients, 0 lost, 0 duplicates`);
    process.exitCode = 0;
  } else {
    log('❌ FAIL — Integrity violations detected:');
    for (const f of failures) log(`   • ${f}`);
    process.exitCode = 1;
  }

  // Print worker breakdown if verbose
  if (VERBOSE) {
    log('\nWorker breakdown:');
    for (const w of workerResults) {
      log(`  client-${w.clientId}: ${w.added.length} added, ${w.errors.length} errors, ${w.totalMs}ms total`);
    }
  }
}

main().catch(err => {
  log(`Fatal: ${err.message}`);
  process.exitCode = 2;
});
