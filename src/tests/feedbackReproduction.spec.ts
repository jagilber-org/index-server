import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { parseToolPayload, waitForServerReady, getResponse, ensureDir } from './testUtils';

/**
 * RED/GREEN Test Suite for Feedback Issue: Bulk Import and Persistence Failures
 *
 * Based on feedback ID: 6c47f5897fb07348
 * Reported problems:
 * 1. Bulk import with valid v2 schema returns "no entries" error
 * 2. Add operations report success but don't persist data
 * 3. Specific instruction IDs fail: service-fabric-diagnostic-methodology, workspace-tool-usage-patterns
 */

function startServer(mutation: boolean, directory?: string) {
  const dir = directory || path.join(process.cwd(), 'tmp', `bulk-import-test-${Date.now()}`);
  ensureDir(dir);
  return spawn('node', [path.join(__dirname, '../../dist/server/index-server.js')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      INDEX_SERVER_MUTATION: mutation ? '1' : '0',
      // Stable or ephemeral instruction directory (passed explicitly for restart persistence tests)
      INDEX_SERVER_DIR: dir
    }
  });
}

function send(proc: ReturnType<typeof spawn>, msg: Record<string, unknown>) {
  proc.stdin?.write(JSON.stringify(msg) + '\n');
}

// Sample instruction data based on reported failing IDs
const FAILING_INSTRUCTION_1 = {
  id: 'service-fabric-diagnostic-methodology',
  title: 'Service Fabric Diagnostic Methodology',
  body: 'Comprehensive diagnostic approach for Service Fabric applications including health monitoring, event analysis, and performance troubleshooting.',
  priority: 25,
  audience: 'all' as const,
  requirement: 'recommended' as const,
  categories: ['azure', 'service-fabric', 'diagnostics'],
  owner: 'platform-team',
  version: '1.0.0'
};

const FAILING_INSTRUCTION_2 = {
  id: 'workspace-tool-usage-patterns',
  title: 'Workspace Tool Usage Patterns',
  body: 'Analysis of tool usage patterns within development workspaces to optimize productivity and identify automation opportunities.',
  priority: 40,
  audience: 'all' as const,
  requirement: 'optional' as const,
  categories: ['workspace', 'productivity', 'analysis'],
  owner: 'dev-experience',
  version: '1.0.0'
};

// Valid v2 schema format bulk import payload (as mentioned in feedback)
const BULK_IMPORT_PAYLOAD = {
  entries: [FAILING_INSTRUCTION_1, FAILING_INSTRUCTION_2],
  mode: 'overwrite' as const
};

describe('Persistence Validation Tests (previously reported issues)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(process.cwd(), 'tmp', `bulk-import-test-${Date.now()}`);
    ensureDir(testDir);
  });

  afterEach(() => {
    // Cleanup test directory
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it('Bulk import with valid v2 schema does not return "no entries" error', async () => {
    const server = startServer(true);
    const out: string[] = [];
    server.stdout.on('data', d => out.push(...d.toString().trim().split(/\n+/)));

    await waitForServerReady(server, out, { initId: 7000, metaId: 7001 });

    // Attempt bulk import with valid payload structure
    send(server, {
      jsonrpc: '2.0',
      id: 7002,
      method: 'tools/call',
      params: {
        name: 'index_dispatch',
        arguments: {
          action: 'import',
          ...BULK_IMPORT_PAYLOAD
        }
      }
    });

    const importResponse = await getResponse(out, 7002, 10000);
    const importPayload = parseToolPayload<{ error?: string; imported?: number; total?: number }>(JSON.stringify(importResponse));

    // RED: This should NOT fail with "no entries" but currently does (based on feedback)
    expect(importPayload?.error).not.toBe('no entries');
    expect(importPayload?.imported).toBeGreaterThan(0);
    expect(importPayload?.total).toBe(2);

    server.kill();
  }, 15000);

  it('Add operation success guarantees immediate persistence (get)', async () => {
    const server = startServer(true);
    const out: string[] = [];
    server.stdout.on('data', d => out.push(...d.toString().trim().split(/\n+/)));

    await waitForServerReady(server, out, { initId: 7010, metaId: 7011 });

    // Add first failing instruction
    send(server, {
      jsonrpc: '2.0',
      id: 7012,
      method: 'tools/call',
      params: {
        name: 'index_dispatch',
        arguments: {
          action: 'add',
          entry: FAILING_INSTRUCTION_1,
          overwrite: true,
          lax: true
        }
      }
    });

    const addResponse = await getResponse(out, 7012, 10000);
    const addPayload = parseToolPayload<{ created?: boolean; verified?: boolean; id?: string }>(JSON.stringify(addResponse));

    // Verify the operation reports success
    expect(addPayload?.created).toBe(true);
    expect(addPayload?.verified).toBe(true);

    // RED: Now verify the instruction actually exists (this is where the bug manifests)
    send(server, {
      jsonrpc: '2.0',
      id: 7013,
      method: 'tools/call',
      params: {
        name: 'index_dispatch',
        arguments: {
          action: 'get',
          id: FAILING_INSTRUCTION_1.id
        }
      }
    });

    const getResp = await getResponse(out, 7013, 10000);
    const getPayload = parseToolPayload<{ item?: any; notFound?: boolean }>(JSON.stringify(getResp));

    // RED: This should NOT be notFound if the add operation truly succeeded
    expect(getPayload?.notFound).not.toBe(true);
    expect(getPayload?.item).toBeTruthy();
    expect(getPayload?.item?.id).toBe(FAILING_INSTRUCTION_1.id);

    server.kill();
  }, 15000);

  // New reproduction-focused test for user reported payload (obfuscation-pattern-gaps-2025)
  it('Reported instruction obfuscation-pattern-gaps-2025 persists and appears via list & export', async () => {
    const server = startServer(true);
    const out: string[] = [];
    server.stdout.on('data', d => out.push(...d.toString().trim().split(/\n+/)));

    await waitForServerReady(server, out, { initId: 7020, metaId: 7021 });

    const REPORTED_INSTRUCTION = {
      id: 'obfuscation-pattern-gaps-2025',
      title: 'Obfuscation Pattern Coverage Gaps - 2025 Tracking',
      body: 'TRACKER ENRICHED: Enumerate sensitive classes missing patterns (financial tokens, extended GUID variants, proprietary session IDs, edge PII). For each: risk, sample, proposed regex, false-positive mitigation, owner, ETA. Update monthly after diff against live pattern registry. GOVERNANCE: owner assigned, P2, 30d review cadence.',
      rationale: 'Reduce unnoticed PII leakage by closing pattern gaps.',
      priority: 76,
      audience: 'security' as const,
      requirement: 'mandatory' as const,
      categories: ['security','obfuscation','pii','tracking'],
      riskScore: 52,
      version: '1.1.0',
      status: 'draft',
      owner: 'team.platform-enablement',
      priorityTier: 'P2' as const,
      classification: 'internal' as const,
      semanticSummary: 'Governed tracker of unaddressed high-risk obfuscation pattern gaps.',
      lastReviewedAt: '2025-08-25T17:20:20.000Z',
      nextReviewDue: '2025-09-24T17:20:20.000Z',
      changeLog: [
        { version:'1.0.0', changedAt:'2025-08-25T16:40:11.000Z', summary:'initial creation' },
        { version:'1.1.0', changedAt:'2025-08-25T17:20:20.000Z', summary:'Governance enrichment (owner,tier,summary,cadence)' }
      ]
    };

    // Add reported instruction
    send(server, { jsonrpc:'2.0', id:7022, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'add', entry: REPORTED_INSTRUCTION, overwrite:true, lax:true } }});
    const addResp = await getResponse(out, 7022, 10000);
    const addPayload = parseToolPayload<{ created?: boolean; verified?: boolean; error?: string }>(JSON.stringify(addResp));
    expect(addPayload?.error).toBeUndefined();
    expect(addPayload?.created).toBe(true);
    expect(addPayload?.verified).toBe(true);

    // Get
    send(server, { jsonrpc:'2.0', id:7023, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'get', id: REPORTED_INSTRUCTION.id } }});
    const getEnv = await getResponse(out, 7023, 10000);
    const getPayload = parseToolPayload<{ item?: any; notFound?: boolean }>(JSON.stringify(getEnv));
    expect(getPayload?.notFound).toBeUndefined();
    expect(getPayload?.item?.id).toBe(REPORTED_INSTRUCTION.id);

    // List
    send(server, { jsonrpc:'2.0', id:7024, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'list' } }});
    const listEnv = await getResponse(out, 7024, 10000);
    const listPayload = parseToolPayload<{ items?: any[]; count?: number }>(JSON.stringify(listEnv));
    expect((listPayload?.items||[]).some(i=> i.id === REPORTED_INSTRUCTION.id)).toBe(true);

    // Export meta-only + full export filtered by id
    send(server, { jsonrpc:'2.0', id:7025, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'export', ids:[REPORTED_INSTRUCTION.id], metaOnly:false } }});
    const exportEnv = await getResponse(out, 7025, 10000);
    const exportPayload = parseToolPayload<{ items?: any[]; count?: number }>(JSON.stringify(exportEnv));
    expect(exportPayload?.count).toBe(1);
    expect(exportPayload?.items?.[0]?.id).toBe(REPORTED_INSTRUCTION.id);
    expect(exportPayload?.items?.[0]?.body?.length).toBeGreaterThan(10);

    server.kill();
  }, 20000);

  it('Red/Green sequence: obfuscation-pattern-gaps-2025 persistence across restart (explicit)', async () => {
    // Use a stable directory across the simulated restart so persistence is actually exercised.
    const persistDir = path.join(process.cwd(), 'tmp', `red-green-restart-${Date.now()}`);
    ensureDir(persistDir);

    // RED PHASE (precondition): instruction should NOT exist before add
    const server1 = startServer(true, persistDir);
    const out1: string[] = [];
    server1.stdout.on('data', d => out1.push(...d.toString().trim().split(/\n+/)));
    await waitForServerReady(server1, out1, { initId: 7120, metaId: 7121 });

    const ID = 'obfuscation-pattern-gaps-2025';

    // Attempt a get before creation -> expect notFound (this is our RED baseline condition)
    send(server1, { jsonrpc:'2.0', id:7122, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'get', id: ID } }});
    const preGet = await getResponse(out1, 7122, 8000);
    const preGetPayload = parseToolPayload<{ item?: any; notFound?: boolean }>(JSON.stringify(preGet));
    expect(preGetPayload?.item).toBeUndefined();
    expect(preGetPayload?.notFound).toBe(true);

    // Add (transition towards GREEN)
    const ENTRY = {
      id: ID,
      title: 'Obfuscation Pattern Coverage Gaps - 2025 Tracking (explicit red/green)',
      body: 'Explicit red/green test variant to validate persistence across restart.',
      requirement: 'mandatory',
  priority: 50,
  // Owner required for mandatory/critical requirements per validation rules
  owner: 'team.platform-enablement'
    };
    send(server1, { jsonrpc:'2.0', id:7123, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'add', entry: ENTRY, overwrite:true, lax:true } }});
    const addResp = await getResponse(out1, 7123, 8000);
    const addPayload = parseToolPayload<{ created?: boolean; verified?: boolean; error?: string }>(JSON.stringify(addResp));
    expect(addPayload?.error).toBeUndefined();
    expect(addPayload?.created).toBe(true);
    expect(addPayload?.verified).toBe(true);

    // Immediate GREEN verification (persistence within same process)
    send(server1, { jsonrpc:'2.0', id:7124, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'get', id: ID } }});
    const postGet = await getResponse(out1, 7124, 8000);
    const postGetPayload = parseToolPayload<{ item?: any; notFound?: boolean }>(JSON.stringify(postGet));
    expect(postGetPayload?.notFound).toBeUndefined();
    expect(postGetPayload?.item?.id).toBe(ID);

    // List contains entry
    send(server1, { jsonrpc:'2.0', id:7125, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'list' } }});
    const listResp = await getResponse(out1, 7125, 8000);
    const listPayload = parseToolPayload<{ items?: any[] }>(JSON.stringify(listResp));
    expect((listPayload?.items||[]).some(i=> i.id===ID)).toBe(true);

    // Export single id
    send(server1, { jsonrpc:'2.0', id:7126, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'export', ids:[ID], metaOnly:false } }});
    const expResp = await getResponse(out1, 7126, 8000);
    const expPayload = parseToolPayload<{ items?: any[]; count?: number }>(JSON.stringify(expResp));
    expect(expPayload?.count).toBe(1);
    expect(expPayload?.items?.[0]?.id).toBe(ID);

    // Simulate restart (persist to disk then reload)
  server1.kill();

  const server2 = startServer(true, persistDir);
    const out2: string[] = [];
    server2.stdout.on('data', d => out2.push(...d.toString().trim().split(/\n+/)));
    await waitForServerReady(server2, out2, { initId: 7130, metaId: 7131 });

    // GREEN PHASE (post-restart persistence): get after restart
    send(server2, { jsonrpc:'2.0', id:7132, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'get', id: ID } }});
    const restartGet = await getResponse(out2, 7132, 8000);
    const restartGetPayload = parseToolPayload<{ item?: any; notFound?: boolean }>(JSON.stringify(restartGet));
    expect(restartGetPayload?.notFound).toBeUndefined();
    expect(restartGetPayload?.item?.id).toBe(ID);

    // Assert body persisted (not truncated)
    expect((restartGetPayload?.item?.body||'').length).toBeGreaterThan(10);

    server2.kill();
  }, 30000);
});

describe('GREEN Tests: Expected Successful Behavior', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(process.cwd(), 'tmp', `bulk-import-success-${Date.now()}`);
    ensureDir(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it('GREEN: Successful bulk import should process all entries', async () => {
    const server = startServer(true);
    const out: string[] = [];
    server.stdout.on('data', d => out.push(...d.toString().trim().split(/\n+/)));

    await waitForServerReady(server, out, { initId: 8000, metaId: 8001 });

    // Simplified payload that should work
    const simplePayload = {
      entries: [{
        id: 'green-test-1',
        title: 'Green Test Entry',
        body: 'This should import successfully',
        priority: 50,
        audience: 'all' as const,
        requirement: 'optional' as const,
        categories: ['test']
      }],
      mode: 'overwrite' as const
    };

    send(server, {
      jsonrpc: '2.0',
      id: 8002,
      method: 'tools/call',
      params: {
        name: 'index_dispatch',
        arguments: {
          action: 'import',
          ...simplePayload
        }
      }
    });

    const importResponse = await getResponse(out, 8002, 10000);
    const importPayload = parseToolPayload<{ imported?: number; total?: number; error?: string }>(JSON.stringify(importResponse));

    // GREEN: Should succeed without errors
    expect(importPayload?.error).toBeUndefined();
    expect(importPayload?.imported).toBe(1);
    expect(importPayload?.total).toBe(1);

    server.kill();
  }, 15000);

  it('GREEN: Successful add operation should guarantee retrievability', async () => {
    const server = startServer(true);
    const out: string[] = [];
    server.stdout.on('data', d => out.push(...d.toString().trim().split(/\n+/)));

    await waitForServerReady(server, out, { initId: 8010, metaId: 8011 });

    const testInstruction = {
      id: 'green-persist-test',
      title: 'Persistence Test',
      body: 'This instruction should persist correctly',
      priority: 30,
      audience: 'all' as const,
      requirement: 'optional' as const,
      categories: ['test', 'persistence']
    };

    // Add instruction
    send(server, {
      jsonrpc: '2.0',
      id: 8012,
      method: 'tools/call',
      params: {
        name: 'index_dispatch',
        arguments: {
          action: 'add',
          entry: testInstruction,
          overwrite: true,
          lax: true
        }
      }
    });

    const addResponse = await getResponse(out, 8012, 10000);
    const addPayload = parseToolPayload<{ created?: boolean; verified?: boolean }>(JSON.stringify(addResponse));

    expect(addPayload?.created).toBe(true);
    expect(addPayload?.verified).toBe(true);

    // GREEN: Retrieve should succeed immediately
    send(server, {
      jsonrpc: '2.0',
      id: 8013,
      method: 'tools/call',
      params: {
        name: 'index_dispatch',
        arguments: {
          action: 'get',
          id: testInstruction.id
        }
      }
    });

    const getResp = await getResponse(out, 8013, 10000);
    const getPayload = parseToolPayload<{ item?: any; notFound?: boolean }>(JSON.stringify(getResp));

    // GREEN: Should find the instruction successfully
    expect(getPayload?.notFound).toBeUndefined();
    expect(getPayload?.item).toBeTruthy();
    expect(getPayload?.item.id).toBe(testInstruction.id);
    expect(getPayload?.item.title).toBe(testInstruction.title);

    server.kill();
  }, 15000);
});

describe('INTEGRATION Tests: End-to-End Backup/Restore Workflow', () => {
  it('Integration: Complete backup/restore cycle should work in single operation', async () => {
    const server = startServer(true);
    const out: string[] = [];
    server.stdout.on('data', d => out.push(...d.toString().trim().split(/\n+/)));

    await waitForServerReady(server, out, { initId: 9000, metaId: 9001 });

    // Simulate a realistic backup file structure
    const backupPayload = {
      entries: [
        {
          id: 'backup-item-1',
          title: 'Backed Up Item 1',
          body: 'Content from backup file',
          priority: 20,
          audience: 'all' as const,
          requirement: 'mandatory' as const,
          categories: ['backup', 'restore'],
          owner: 'admin'
        },
        {
          id: 'backup-item-2',
          title: 'Backed Up Item 2',
          body: 'More content from backup file',
          priority: 35,
          audience: 'all' as const,
          requirement: 'recommended' as const,
          categories: ['backup', 'restore'],
          owner: 'admin'
        }
      ],
      mode: 'overwrite' as const
    };

    // Single bulk restore operation
    send(server, {
      jsonrpc: '2.0',
      id: 9002,
      method: 'tools/call',
      params: {
        name: 'index_dispatch',
        arguments: {
          action: 'import',
          ...backupPayload
        }
      }
    });

    const restoreResponse = await getResponse(out, 9002, 10000);
    const restorePayload = parseToolPayload<{ imported?: number; total?: number; error?: string }>(JSON.stringify(restoreResponse));

    // Should complete in single operation without requiring manual retries
    expect(restorePayload?.error).toBeUndefined();
    expect(restorePayload?.imported).toBe(2);
    expect(restorePayload?.total).toBe(2);

    // Verify all items are immediately available
    send(server, {
      jsonrpc: '2.0',
      id: 9003,
      method: 'tools/call',
      params: {
        name: 'index_dispatch',
        arguments: {
          action: 'list'
        }
      }
    });

    const listResponse = await getResponse(out, 9003, 10000);
    const listPayload = parseToolPayload<{ count?: number; items?: any[] }>(JSON.stringify(listResponse));

    expect(listPayload?.count).toBeGreaterThanOrEqual(2);
    expect(listPayload?.items?.map(item => item.id)).toEqual(
      expect.arrayContaining(['backup-item-1', 'backup-item-2'])
    );

    server.kill();
  }, 15000);
});
