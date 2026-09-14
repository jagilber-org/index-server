/**
 * Coverage for #505: governanceUpdate categories write path and Zod widening.
 *
 * B1a — integration tests for the `categories` branch in instructions.patch.ts:106-112
 * B1b — unit tests proving Zod `.strict()` accepts the four new fields and still
 *        rejects unknown fields.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTestClient, type TestClient } from './helpers/mcpTestClient.js';

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

// ── B1a: governanceUpdate categories write path ─────────────────────────────

describe('#505 governanceUpdate categories', () => {
  const instructionsDir = makeTempDir('gov-update-categories-505');
  let client: TestClient;

  beforeAll(async () => {
    client = await createTestClient({ instructionsDir, forceMutation: true });
  }, 30000);

  afterAll(async () => { await client?.close(); });

  async function seed(id: string, extra: Record<string, unknown> = {}) {
    const resp = await client.callToolJSON('index_add', {
      entry: {
        id,
        title: `Seed ${id}`,
        body: 'Seed body for categories test.',
        categories: ['zebra', 'apple'],
        ...extra,
      },
      lax: true,
      overwrite: true,
    });
    expect(resp?.created || resp?.overwritten).toBeTruthy();
    return resp;
  }

  it('normalizes, dedupes, sorts, and persists categories', async () => {
    const id = 'iss505-cats-norm-' + Date.now();
    await seed(id);

    const resp = await client.callToolJSON('index_governanceUpdate', {
      id,
      categories: ['Zulu', 'alpha', 'ALPHA', 'zulu', 'Bravo'],
    });
    expect(resp?.changed).toBe(true);
    expect(resp?.categories).toEqual(['alpha', 'bravo', 'zulu']);

    const disk = readDiskEntry(instructionsDir, id);
    expect(disk?.categories).toEqual(['alpha', 'bravo', 'zulu']);
  });

  it('rejects an empty categories array', async () => {
    const id = 'iss505-cats-empty-' + Date.now();
    await seed(id);

    const resp = await client.callToolJSON('index_governanceUpdate', {
      id,
      categories: [],
    });
    expect(resp?.error).toBeTruthy();
    expect(resp?.changed).toBeFalsy();

    const disk = readDiskEntry(instructionsDir, id);
    expect(disk?.categories).toEqual(['apple', 'zebra']);
  });

  it('sets primaryCategory to cats[0] (alphabetically first after sort)', async () => {
    const id = 'iss505-cats-primary-' + Date.now();
    await seed(id, { categories: ['zzz'] });

    const resp = await client.callToolJSON('index_governanceUpdate', {
      id,
      categories: ['Mango', 'Apple', 'Cherry'],
    });
    expect(resp?.changed).toBe(true);

    const disk = readDiskEntry(instructionsDir, id);
    expect(disk?.categories).toEqual(['apple', 'cherry', 'mango']);
    expect(disk?.primaryCategory).toBe('apple');
  });

  it('returns changed:false when categories already match', async () => {
    const id = 'iss505-cats-noop-' + Date.now();
    await seed(id, { categories: ['alpha', 'bravo'] });

    const resp = await client.callToolJSON('index_governanceUpdate', {
      id,
      categories: ['bravo', 'ALPHA'],
    });
    expect(resp?.changed).toBe(false);
  });
});

// ── B1b: Zod .strict() widening ─────────────────────────────────────────────

describe('#505 zGovernanceUpdate Zod widening', () => {
  let getZodSchema: (name: string) => import('zod').ZodTypeAny | undefined;

  beforeAll(async () => {
    const mod = await import('../services/toolRegistry.zod.js');
    getZodSchema = mod.getZodSchema;
  });

  it('accepts riskScore', () => {
    const schema = getZodSchema('index_governanceUpdate')!;
    expect(schema).toBeTruthy();
    const result = schema.safeParse({ id: 'test', riskScore: 42 });
    expect(result.success).toBe(true);
  });

  it('accepts priority', () => {
    const schema = getZodSchema('index_governanceUpdate')!;
    const result = schema.safeParse({ id: 'test', priority: 50 });
    expect(result.success).toBe(true);
  });

  it('accepts priorityTier', () => {
    const schema = getZodSchema('index_governanceUpdate')!;
    const result = schema.safeParse({ id: 'test', priorityTier: 'P2' });
    expect(result.success).toBe(true);
  });

  it('accepts requirement', () => {
    const schema = getZodSchema('index_governanceUpdate')!;
    const result = schema.safeParse({ id: 'test', requirement: 'optional' });
    expect(result.success).toBe(true);
  });

  it('still rejects unknown fields (.strict() enforced)', () => {
    const schema = getZodSchema('index_governanceUpdate')!;
    const result = schema.safeParse({ id: 'test', bogusField: 'x' });
    expect(result.success).toBe(false);
  });
});
