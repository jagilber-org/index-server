/**
 * Regression coverage for #350: field-level data loss on index_add write path.
 *
 * Bugs being verified as fixed:
 *  1. Caller-supplied `riskScore` was unconditionally overwritten by
 *     `ClassificationService.computeRisk()`.
 *  2. Caller-supplied `teamIds` (and several other scoping/governance fields)
 *     were silently dropped by the new-entry assembly in `instructions.add.ts`
 *     because the `base` object literal omitted them.
 *
 * Each test goes through the public MCP surface: index_add (via dispatcher)
 * then index_dispatch get, then index_dispatch reload + get, and asserts
 * the disk-persisted record preserves what the caller supplied.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTestClient } from './helpers/mcpTestClient.js';

function makeTempDir(name: string) {
  const dir = path.join(process.cwd(), 'tmp', name);
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function readDiskEntry(dir: string, id: string): Record<string, unknown> | null {
  const filePath = path.join(dir, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

interface AddResp { created?: boolean; overwritten?: boolean; id?: string }
interface GetResp { item?: Record<string, unknown>; id?: string }

function unwrapEntry(resp: GetResp | Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!resp) return undefined;
  const r = resp as GetResp;
  if (r.item && typeof r.item === 'object') return r.item as Record<string, unknown>;
  if ((resp as Record<string, unknown>).id) return resp as Record<string, unknown>;
  return undefined;
}

describe('issue #350: index_add field preservation', () => {
  const instructionsDir = makeTempDir('add-field-preservation-350');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;

  beforeAll(async () => {
    client = await createTestClient({
      instructionsDir,
      forceMutation: true,
    });
  }, 30000);

  afterAll(async () => { await client?.close(); });

  it('riskScore: caller value is preserved, not overwritten by computeRisk', async () => {
    const id = 'iss350-riskscore-' + Date.now();
    const callerRisk = 42;

    const addResp = (await client.callToolJSON('index_add', {
      entry: {
        id,
        title: 'RiskScore preservation',
        body: 'Caller supplied riskScore must round-trip.',
        riskScore: callerRisk,
      },
      lax: true,
      overwrite: true,
    })) as AddResp;
    expect(addResp?.created || addResp?.overwritten).toBeTruthy();

    // Disk-level assertion: classifier ran before persist, so disk must hold caller value.
    const disk = readDiskEntry(instructionsDir, id);
    expect(disk, 'disk file missing').toBeTruthy();
    expect(disk?.riskScore).toBe(callerRisk);

    // In-memory index assertion via dispatcher get
    const got = unwrapEntry(await client.callToolJSON('index_dispatch', { action: 'get', id }));
    expect(got?.riskScore).toBe(callerRisk);

    // Survive reload from disk
    await client.callToolJSON('index_dispatch', { action: 'reload' });
    const afterReload = unwrapEntry(await client.callToolJSON('index_dispatch', { action: 'get', id }));
    expect(afterReload?.riskScore).toBe(callerRisk);
  });

  it('riskScore: omitted by caller falls back to computed value (>=0)', async () => {
    const id = 'iss350-riskscore-default-' + Date.now();
    await client.callToolJSON('index_add', {
      entry: {
        id,
        title: 'RiskScore default',
        body: 'No caller riskScore supplied; classifier should compute one.',
      },
      lax: true,
      overwrite: true,
    });

    const disk = readDiskEntry(instructionsDir, id);
    expect(disk).toBeTruthy();
    expect(typeof disk?.riskScore).toBe('number');
    expect(disk?.riskScore as number).toBeGreaterThanOrEqual(0);
  });

  it('teamIds: caller value is preserved through add and reload', async () => {
    const id = 'iss350-teamids-' + Date.now();
    const teamIds = ['team-alpha', 'team-beta'];

    const addResp = (await client.callToolJSON('index_add', {
      entry: {
        id,
        title: 'teamIds preservation',
        body: 'Caller supplied teamIds must round-trip.',
        teamIds,
      },
      lax: true,
      overwrite: true,
    })) as AddResp;
    expect(addResp?.created || addResp?.overwritten).toBeTruthy();

    const disk = readDiskEntry(instructionsDir, id);
    expect(disk, 'disk file missing').toBeTruthy();
    expect(disk?.teamIds).toEqual(teamIds);

    const got = unwrapEntry(await client.callToolJSON('index_dispatch', { action: 'get', id }));
    expect(got?.teamIds).toEqual(teamIds);

    await client.callToolJSON('index_dispatch', { action: 'reload' });
    const afterReload = unwrapEntry(await client.callToolJSON('index_dispatch', { action: 'get', id }));
    expect(afterReload?.teamIds).toEqual(teamIds);
  });

  it('scoping + governance fields (workspaceId, userId, supersedes, reviewIntervalDays) round-trip', async () => {
    const id = 'iss350-scoping-' + Date.now();
    const entry = {
      id,
      title: 'Scoping fields preservation',
      body: 'workspaceId/userId/supersedes/reviewIntervalDays must round-trip on index_add.',
      workspaceId: 'ws-1',
      userId: 'user-42',
      supersedes: 'iss350-old-entry',
      reviewIntervalDays: 30,
    };

    const addResp = (await client.callToolJSON('index_add', {
      entry,
      lax: true,
      overwrite: true,
    })) as AddResp;
    expect(addResp?.created || addResp?.overwritten).toBeTruthy();

    const disk = readDiskEntry(instructionsDir, id);
    expect(disk).toBeTruthy();
    expect(disk?.workspaceId).toBe('ws-1');
    expect(disk?.userId).toBe('user-42');
    expect(disk?.supersedes).toBe('iss350-old-entry');
    expect(disk?.reviewIntervalDays).toBe(30);
  });

  it('combined: riskScore + teamIds preserved together on a single add', async () => {
    const id = 'iss350-combined-' + Date.now();
    await client.callToolJSON('index_add', {
      entry: {
        id,
        title: 'Combined fields',
        body: 'riskScore and teamIds set on the same entry.',
        riskScore: 7,
        teamIds: ['t-one'],
      },
      lax: true,
      overwrite: true,
    });

    const disk = readDiskEntry(instructionsDir, id);
    expect(disk?.riskScore).toBe(7);
    expect(disk?.teamIds).toEqual(['t-one']);
  });
});
