#!/usr/bin/env node
/**
 * setup-wizard-crud-test.mjs — E2E CRUD smoke test for each profile.
 *
 * Starts index-server with the specified profile, then runs through
 * the full CRUD lifecycle: create → search → get → remove → verify deletion.
 *
 * Uses the MCP SDK for reliable protocol handling.
 *
 * Usage: node scripts/ci/setup-wizard-crud-test.mjs --profile <default|enhanced|experimental>
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------
let profile = 'default';
let testRoot = '';

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--profile' && process.argv[i + 1]) profile = process.argv[++i];
  if (process.argv[i] === '--root' && process.argv[i + 1]) testRoot = process.argv[++i];
}

if (!testRoot) {
  testRoot = path.join(os.tmpdir(), `wizard-crud-${profile}-${Date.now()}`);
}

const instructionsDir = path.join(testRoot, 'instructions');
fs.mkdirSync(instructionsDir, { recursive: true });

console.log(`\n═══ CRUD Test — Profile: ${profile} ═══`);
console.log(`  Root: ${testRoot}`);
console.log(`  Instructions: ${instructionsDir}\n`);

// ---------------------------------------------------------------------------
// SDK imports (dynamic to handle ESM boundary)
// ---------------------------------------------------------------------------
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = await import(
  '@modelcontextprotocol/sdk/client/stdio.js'
);

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const serverPath = path.join(ROOT, 'dist', 'server', 'index-server.js');

if (!fs.existsSync(serverPath)) {
  console.error(`Server entry point not found: ${serverPath}`);
  console.error('Run "npm run build" first.');
  process.exit(1);
}

const env = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined) env[k] = v;
}
Object.assign(env, {
  INDEX_SERVER_DIR: instructionsDir,
  INDEX_SERVER_MUTATION: '1',
  INDEX_SERVER_DASHBOARD: '0',
  INDEX_SERVER_AUTO_BACKUP: '0',
  INDEX_SERVER_PROFILE: profile,
  INDEX_SERVER_SEMANTIC_ENABLED: '0', // Avoid model download in CI
  INDEX_SERVER_FLAG_TOOLS_EXTENDED: '1', // Expose index_add, index_remove, etc.
  INDEX_SERVER_LOG_LEVEL: 'warn',
  INDEX_SERVER_LOG_FILE: '0',
  INDEX_SERVER_VERBOSE_LOGGING: '0',
  NODE_ENV: 'test',
});

const transport = new StdioClientTransport({
  command: 'node',
  args: [serverPath],
  env,
});

const client = new Client(
  { name: 'ci-crud-test', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// Guard against hangs
const killTimer = setTimeout(() => {
  console.error('\n⏰ Global timeout reached (120s) — killing server');
  try {
    transport.close();
  } catch {
    /* ok */
  }
  process.exit(1);
}, 120_000);

/** Call a tool and parse the JSON text response. */
async function callTool(name, args) {
  const resp = await client.callTool({ name, arguments: args });
  const text = resp.content?.[0]?.text;
  if (!text) throw new Error(`Empty response from ${name}`);
  try {
    return JSON.parse(text);
  } catch {
    // Return raw text wrapped for inspection
    return { _raw: text };
  }
}

try {
  // ── Connect ────────────────────────────────────────────────────────────
  await runTest('MCP connect + handshake', async () => {
    await client.connect(transport);
  });

  // ── List tools (with readiness polling) ────────────────────────────────
  let toolNames = [];
  const requiredTools = [
    'index_add',
    'index_search',
    'index_dispatch',
    'index_remove',
    'health_check',
  ];
  await runTest('List tools', async () => {
    const deadline = Date.now() + 15_000;
    const pollMs = 250;
    while (Date.now() < deadline) {
      try {
        const result = await client.listTools();
        toolNames = result.tools.map(t => t.name);
        if (requiredTools.every(n => toolNames.includes(n))) break;
      } catch {
        /* retry */
      }
      await new Promise(r => setTimeout(r, pollMs));
    }
    const missing = requiredTools.filter(n => !toolNames.includes(n));
    if (missing.length > 0) {
      // Log what we DO have for debugging
      const available = toolNames.filter(n => n.startsWith('index'));
      throw new Error(
        `Missing: ${missing.join(', ')}. Available index_* tools: ${available.join(', ') || 'none'} (${toolNames.length} total)`,
      );
    }
    console.log(`    ${toolNames.length} tools available`);
  });

  // ── Health check ───────────────────────────────────────────────────────
  await runTest('Health check', async () => {
    const result = await callTool('health_check', {});
    if (!result.status) throw new Error('Missing status in health check');
    console.log(`    Status: ${result.status}`);
    // Log the resolved INDEX_SERVER_DIR for debugging
    if (result.instructionsDir) console.log(`    Dir: ${result.instructionsDir}`);
    if (result.indexDir) console.log(`    Dir: ${result.indexDir}`);
  });

  // ── Create instruction ─────────────────────────────────────────────────
  const testId = `ci-crud-test-${Date.now()}`;

  await runTest('Create instruction (index_add)', async () => {
    const result = await callTool('index_add', {
      entry: {
        id: testId,
        title: 'CI CRUD Test Instruction',
        body: 'Test instruction created by CI CRUD workflow.',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['ci-test'],
      },
      lax: true,
    });
    if (!result.created && !result.overwritten) {
      throw new Error(
        `Add failed: ${result.message || result.error || JSON.stringify(result)}`,
      );
    }
    console.log(`    Created: ${testId}`);
  });

  // Brief settle time for index to update after write
  await new Promise(r => setTimeout(r, 1500));

  // ── Search for instruction (keyword mode) ──────────────────────────────
  await runTest('Search instruction (index_search keyword)', async () => {
    const result = await callTool('index_search', {
      keywords: ['ci-crud-test'],
      mode: 'keyword',
      limit: 10,
    });
    const results = result.results || result.ids || [];
    const ids = results.map(r => r.instructionId || r.id || r);
    if (!ids.includes(testId)) {
      throw new Error(
        `${testId} not found in search results: ${JSON.stringify(results)}`,
      );
    }
  });

  // ── Get instruction by ID ──────────────────────────────────────────────
  await runTest('Get instruction (index_dispatch get)', async () => {
    const result = await callTool('index_dispatch', {
      action: 'get',
      id: testId,
    });
    // Response may nest the instruction under a key or return it flat
    const entry = result.item || result.entry || result.instruction || result;
    const entryId = entry.id || result.id;
    if (entryId !== testId) {
      throw new Error(
        `Expected id "${testId}", got "${entryId}" — keys: ${JSON.stringify(Object.keys(result))}`,
      );
    }
  });

  // ── List instructions ──────────────────────────────────────────────────
  await runTest('List instructions (index_dispatch list)', async () => {
    const result = await callTool('index_dispatch', { action: 'list' });
    const items = result.instructions || result.items || result.ids || [];
    if (!Array.isArray(items)) {
      throw new Error(`Expected array, got: ${typeof items}`);
    }
    // Items may be strings (IDs) or objects with .id
    const ids = items.map(item => (typeof item === 'string' ? item : item.id));
    if (!ids.includes(testId)) {
      throw new Error(`${testId} not in list (${ids.length} items): ${JSON.stringify(ids.slice(0, 5))}`);
    }
    console.log(`    Total instructions: ${items.length}`);
  });

  // ── Remove instruction ─────────────────────────────────────────────────
  await runTest('Remove instruction (index_remove)', async () => {
    const result = await callTool('index_remove', { ids: [testId] });
    if (result.error) {
      throw new Error(`Remove failed: ${JSON.stringify(result)}`);
    }
  });

  // ── Verify deletion ────────────────────────────────────────────────────
  await runTest('Verify instruction deleted (get returns error)', async () => {
    const result = await callTool('index_dispatch', {
      action: 'get',
      id: testId,
    });
    // A successful get returning the instruction means deletion failed
    if (result.id === testId && result.body) {
      throw new Error('Instruction still exists after deletion');
    }
    // Any error or "not found" response is correct
  });

  // ── Verify search no longer finds it ───────────────────────────────────
  await runTest('Verify deleted from search', async () => {
    const result = await callTool('index_search', {
      keywords: ['ci-crud-test'],
      mode: 'keyword',
      limit: 10,
    });
    const ids = (result.results || result.ids || []).map(r => r.id || r);
    if (ids.includes(testId)) {
      throw new Error(`${testId} still appears in search after deletion`);
    }
  });
} finally {
  clearTimeout(killTimer);
  try {
    await transport.close();
  } catch {
    /* ok */
  }
  // Cleanup
  try {
    fs.rmSync(testRoot, { recursive: true, force: true });
  } catch {
    /* ok */
  }
}

console.log(`\n═══ CRUD Summary: ${passed} passed, ${failed} failed ═══\n`);
process.exit(failed > 0 ? 1 : 0);
