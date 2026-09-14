/**
 * Regression coverage for #492 and #493: governance fields silently dropped on
 * the write paths that already advertise them.
 *
 *  #492 — `index_add { overwrite: true }` against an existing entry discarded
 *         caller-supplied `riskScore` / `reviewIntervalDays`. #350 fixed only
 *         the create branch; the update branch merges `ADD_GOVERNANCE_KEYS`,
 *         which did not list either field.
 *  #493 — `index_governanceUpdate` accepted `riskScore`, `priority`,
 *         `priorityTier` and `requirement` (all advertised by the dispatcher
 *         schema) and reported `changed: true` without persisting them.
 *
 * Everything goes through the public MCP surface and asserts against the
 * on-disk record, so a handler that answers optimistically cannot pass.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTestClient, callAllowingRejection } from './helpers/mcpTestClient.js';

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
interface GovResp {
  id?: string; changed?: boolean; error?: string; provided?: unknown;
  riskScore?: number; priority?: number; priorityTier?: string; requirement?: string;
}

describe('#492 / #493: write-path governance field preservation', () => {
  const instructionsDir = makeTempDir('write-path-governance-fields');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;

  beforeAll(async () => {
    client = await createTestClient({ instructionsDir, forceMutation: true });
  }, 30000);

  afterAll(async () => { await client?.close(); });

  async function seed(id: string, entry: Record<string, unknown> = {}) {
    const resp = (await client.callToolJSON('index_add', {
      entry: {
        id,
        title: 'Seed entry',
        body: 'Seed body for governance field preservation.',
        riskScore: 99,
        reviewIntervalDays: 30,
        ...entry,
      },
      lax: true,
      overwrite: true,
    })) as AddResp;
    expect(resp?.created || resp?.overwritten).toBeTruthy();
    return resp;
  }

  describe('#492 index_add overwrite', () => {
    it('applies caller-supplied riskScore to an existing entry', async () => {
      const id = 'iss492-risk-' + Date.now();
      await seed(id);
      expect(readDiskEntry(instructionsDir, id)?.riskScore).toBe(99);

      const resp = (await client.callToolJSON('index_add', {
        entry: {
          id,
          title: 'Seed entry',
          body: 'Seed body for governance field preservation.',
          riskScore: 20,
        },
        lax: true,
        overwrite: true,
      })) as AddResp;
      expect(resp?.overwritten).toBeTruthy();

      expect(readDiskEntry(instructionsDir, id)?.riskScore).toBe(20);
    });

    it('applies caller-supplied reviewIntervalDays to an existing entry', async () => {
      const id = 'iss492-interval-' + Date.now();
      await seed(id);
      expect(readDiskEntry(instructionsDir, id)?.reviewIntervalDays).toBe(30);

      await client.callToolJSON('index_add', {
        entry: {
          id,
          title: 'Seed entry',
          body: 'Seed body for governance field preservation.',
          reviewIntervalDays: 180,
        },
        lax: true,
        overwrite: true,
      });

      expect(readDiskEntry(instructionsDir, id)?.reviewIntervalDays).toBe(180);
    });

    it('carries the stored value forward when the caller omits the field', async () => {
      const id = 'iss492-carry-' + Date.now();
      await seed(id);

      await client.callToolJSON('index_add', {
        entry: {
          id,
          title: 'Seed entry',
          body: 'Seed body for governance field preservation.',
        },
        lax: true,
        overwrite: true,
      });

      const disk = readDiskEntry(instructionsDir, id);
      expect(disk?.riskScore).toBe(99);
      expect(disk?.reviewIntervalDays).toBe(30);
    });
  });

  describe('#492 index_import overwrite', () => {
    it('applies caller-supplied riskScore and reviewIntervalDays', async () => {
      const id = 'iss492-import-' + Date.now();
      await seed(id);

      await client.callToolJSON('index_import', {
        entries: [{
          id,
          title: 'Seed entry',
          body: 'Seed body for governance field preservation.',
          priority: 50,
          audience: 'all',
          requirement: 'optional',
          riskScore: 15,
          reviewIntervalDays: 120,
        }],
        mode: 'overwrite',
      });

      const disk = readDiskEntry(instructionsDir, id);
      expect(disk?.riskScore).toBe(15);
      expect(disk?.reviewIntervalDays).toBe(120);
    });
  });

  describe('#493 index_governanceUpdate', () => {
    it('persists riskScore', async () => {
      const id = 'iss493-risk-' + Date.now();
      await seed(id);

      const resp = (await client.callToolJSON('index_governanceUpdate', {
        id, riskScore: 20,
      })) as GovResp;
      expect(resp?.changed).toBe(true);
      expect(resp?.riskScore).toBe(20);

      expect(readDiskEntry(instructionsDir, id)?.riskScore).toBe(20);
    });

    it('persists priority, priorityTier and requirement', async () => {
      const id = 'iss493-fields-' + Date.now();
      await seed(id, { owner: 'jason' });

      const resp = (await client.callToolJSON('index_governanceUpdate', {
        id, priority: 60, priorityTier: 'P3', requirement: 'optional',
      })) as GovResp;
      expect(resp?.changed).toBe(true);

      const disk = readDiskEntry(instructionsDir, id);
      expect(disk?.priority).toBe(60);
      expect(disk?.priorityTier).toBe('P3');
      expect(disk?.requirement).toBe('optional');
    });

    it('reports changed:false when supplied values already match', async () => {
      const id = 'iss493-noop-' + Date.now();
      await seed(id);

      const resp = (await client.callToolJSON('index_governanceUpdate', {
        id, riskScore: 99,
      })) as GovResp;
      expect(resp?.changed).toBe(false);
    });

    it('rejects a non-numeric riskScore instead of silently ignoring it', async () => {
      const id = 'iss493-badrisk-' + Date.now();
      await seed(id);

      const resp = (await callAllowingRejection(() => client.callToolJSON('index_governanceUpdate', {
        id, riskScore: 'high',
      }))) as GovResp;
      expect(resp?.error).toBeTruthy();
      expect(resp?.changed).toBeFalsy();

      expect(readDiskEntry(instructionsDir, id)?.riskScore).toBe(99);
    });

    it('rejects an out-of-range priority instead of silently ignoring it', async () => {
      const id = 'iss493-badpriority-' + Date.now();
      await seed(id);
      const before = readDiskEntry(instructionsDir, id)?.priority;

      const resp = (await callAllowingRejection(() => client.callToolJSON('index_governanceUpdate', {
        id, priority: 5000,
      }))) as GovResp;
      expect(resp?.error).toBeTruthy();
      expect(resp?.changed).toBeFalsy();

      expect(readDiskEntry(instructionsDir, id)?.priority).toBe(before);
    });

    it('rejects an invalid requirement instead of silently ignoring it', async () => {
      const id = 'iss493-badreq-' + Date.now();
      await seed(id);

      const resp = (await client.callToolJSON('index_governanceUpdate', {
        id, requirement: 'not-a-requirement',
      })) as GovResp;
      expect(resp?.error).toBeTruthy();
      expect(resp?.changed).toBeFalsy();
    });
  });
});
