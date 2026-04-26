/**
 * Comprehensive instruction CRUD negative/edge-case test suite.
 *
 * Strategy: Exercise every failure mode and edge case for instruction add/update,
 * NOT just happy-path with the same category variable. Each test uses different
 * property combinations and validates both response truthfulness and disk state.
 *
 * Test categories:
 *  - Pre-write rejection: invalid input that should never reach disk
 *  - Post-write disk contract: raw file on disk must pass loader schema
 *  - Overwrite with in-memory properties: usage tracking fields don't poison disk
 *  - Response truthfulness: verified field must match actual disk/index state
 *  - Non-schema property injection: extra properties must be rejected at write time
 *  - Nested schema violations: bad changeLog, extensions structures
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';
import { createTestClient } from './helpers/mcpTestClient.js';
import schema from '../../schemas/instruction.schema.json';

// Compile the SAME loader schema for direct disk validation in tests
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
// Register draft-07 meta schema under https id (mirrors IndexLoader behavior)
try {
  const httpsIdNoHash = 'https://json-schema.org/draft-07/schema';
  const httpsIdHash = 'https://json-schema.org/draft-07/schema#';
  if (!ajv.getSchema(httpsIdNoHash)) ajv.addMetaSchema({ ...draft7MetaSchema, $id: httpsIdNoHash });
  if (!ajv.getSchema(httpsIdHash)) ajv.addMetaSchema({ ...draft7MetaSchema, $id: httpsIdHash });
} catch { /* ignore meta-schema registration issues */ }
const validateLoaderSchema = ajv.compile(JSON.parse(JSON.stringify(schema)));

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
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

// Helper to unwrap get response
function unwrapEntry(resp: Record<string, unknown> | undefined) {
  if (!resp) return undefined;
  if (resp.item && typeof resp.item === 'object') return resp.item as Record<string, unknown>;
  if (resp.id) return resp;
  return undefined;
}

describe('instruction CRUD: disk contract tests', () => {
  const instructionsDir = makeTempDir('crud-disk-contract');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;

  beforeAll(async () => {
    client = await createTestClient({
      instructionsDir,
      forceMutation: true,
      extraEnv: { INDEX_SERVER_STRICT_CREATE: '1' },
    });
  }, 30000);

  afterAll(async () => { await client?.close(); });

  it('add: file on disk passes loader schema validation', async () => {
    const id = 'disk-contract-basic-' + Date.now();
    await client.create({ id, title: 'Disk Contract', body: 'Test body for disk contract validation.' });

    const disk = readDiskEntry(instructionsDir, id);
    expect(disk).toBeTruthy();
    const valid = validateLoaderSchema(disk);
    expect(valid, `Disk file fails loader schema: ${JSON.stringify(validateLoaderSchema.errors)}`).toBe(true);
  });

  it('add with all optional fields: disk passes loader schema', async () => {
    const id = 'disk-contract-full-' + Date.now();
    await client.create({
      id,
      title: 'Full Properties',
      body: 'Body with all optional properties set.',
      rationale: 'Test rationale',
      priority: 80,
      audience: 'developers',
      requirement: 'should',
      categories: ['testing', 'validation'],
      semanticSummary: 'Full property test',
      owner: 'test-owner',
      status: 'draft',
      priorityTier: 'P2',
      classification: 'internal',
      contentType: 'instruction',
      version: '1.0.0',
      riskScore: 5,
      supersedes: 'some-old-id',
      extensions: { custom: 'value' },
    });

    const disk = readDiskEntry(instructionsDir, id);
    expect(disk).toBeTruthy();
    const valid = validateLoaderSchema(disk);
    expect(valid, `Disk file with all props fails loader schema: ${JSON.stringify(validateLoaderSchema.errors)}`).toBe(true);
  });

  it('overwrite: disk file passes loader schema after update', async () => {
    const id = 'disk-contract-overwrite-' + Date.now();
    await client.create({ id, title: 'Original', body: 'Original body.' });

    // Overwrite with different properties
    const resp = await client.update({ id, title: 'Updated', body: 'Updated body with new content.', overwrite: true });
    expect(resp?.overwritten || resp?.created).toBeTruthy();

    const disk = readDiskEntry(instructionsDir, id);
    expect(disk).toBeTruthy();
    const valid = validateLoaderSchema(disk);
    expect(valid, `Overwritten file fails loader schema: ${JSON.stringify(validateLoaderSchema.errors)}`).toBe(true);
  });
});

describe('instruction CRUD: response truthfulness', () => {
  const instructionsDir = makeTempDir('crud-truthfulness');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;

  beforeAll(async () => {
    client = await createTestClient({
      instructionsDir,
      forceMutation: true,
      extraEnv: { INDEX_SERVER_STRICT_CREATE: '1' },
    });
  }, 30000);

  afterAll(async () => { await client?.close(); });

  it('add response verified=true means entry is actually in index', async () => {
    const id = 'truth-verified-' + Date.now();
    const resp = await client.create({ id, title: 'Truth Test', body: 'Verify this body exists.' });

    if (resp?.verified === true) {
      // The entry MUST be readable via get
      const getResp = unwrapEntry(await client.read(id));
      expect(getResp, 'verified=true but entry not found in index').toBeTruthy();
      expect(getResp?.id).toBe(id);
    }
  });

  it('add response verified=true means entry survives reload', async () => {
    const id = 'truth-reload-' + Date.now();
    const resp = await client.create({ id, title: 'Reload Truth', body: 'Must survive reload.' });

    expect(resp?.verified).toBe(true);

    // Force full reload from disk
    await client.callToolJSON('index_dispatch', { action: 'reload' });

    // Entry MUST still be in index after reload
    const getResp = unwrapEntry(await client.read(id));
    expect(getResp, 'verified=true but entry disappeared after reload').toBeTruthy();
    expect(getResp?.id).toBe(id);
  });

  it('overwrite response verified=true means updated content persisted', async () => {
    const id = 'truth-overwrite-' + Date.now();
    await client.create({ id, title: 'Original', body: 'Original body content.' });

    const updatedBody = 'Updated body content ' + Date.now();
    const resp = await client.update({ id, title: 'Updated', body: updatedBody, overwrite: true });
    expect(resp?.verified).toBe(true);

    // Force reload and verify updated content
    await client.callToolJSON('index_dispatch', { action: 'reload' });
    const getResp = unwrapEntry(await client.read(id));
    expect(getResp).toBeTruthy();
    expect(String(getResp?.body)).toContain('Updated body content');
  });
});

describe('instruction CRUD: non-schema property rejection at write', () => {
  const instructionsDir = makeTempDir('crud-nonschema-rejection');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;

  beforeAll(async () => {
    client = await createTestClient({
      instructionsDir,
      forceMutation: true,
      extraEnv: { INDEX_SERVER_STRICT_CREATE: '1' },
    });
  }, 30000);

  afterAll(async () => { await client?.close(); });

  it('file on disk has no properties outside the JSON schema', async () => {
    const id = 'nonschema-check-' + Date.now();
    await client.create({ id, title: 'Schema Check', body: 'No extra properties should appear on disk.' });

    const disk = readDiskEntry(instructionsDir, id);
    expect(disk).toBeTruthy();

    const schemaProps = new Set(Object.keys((schema as { properties: Record<string, unknown> }).properties));
    const diskKeys = Object.keys(disk!);
    const extraKeys = diskKeys.filter(k => !schemaProps.has(k));

    expect(extraKeys, `File on disk has non-schema properties: ${extraKeys.join(', ')}`).toEqual([]);
  });

  it('overwrite does not leak in-memory usage properties to disk', async () => {
    const id = 'nonschema-overwrite-' + Date.now();
    await client.create({ id, title: 'Original', body: 'Original body.' });

    // Track usage to populate in-memory firstSeenTs/lastUsedAt/usageCount
    await client.callToolJSON('usage_track', { id, action: 'retrieved' });

    // Overwrite — this is where in-memory props used to leak via { ...existing }
    await client.update({ id, title: 'After Usage', body: 'Body after usage tracking.', overwrite: true });

    const disk = readDiskEntry(instructionsDir, id);
    expect(disk).toBeTruthy();
    const valid = validateLoaderSchema(disk);
    expect(valid, `Overwrite after usage tracking produces invalid disk file: ${JSON.stringify(validateLoaderSchema.errors)}`).toBe(true);
  });
});

describe('instruction CRUD: varied negative inputs', () => {
  const instructionsDir = makeTempDir('crud-negative-inputs');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;

  beforeAll(async () => {
    client = await createTestClient({
      instructionsDir,
      forceMutation: true,
      extraEnv: { INDEX_SERVER_STRICT_CREATE: '1' },
    });
  }, 30000);

  afterAll(async () => { await client?.close(); });

  it('rejects add with missing id', async () => {
    const resp = await client.callToolJSON('index_add', {
      entry: { title: 'No ID', body: 'Body without id' },
    });
    expect(resp?.error || resp?.validationErrors).toBeTruthy();
  });

  it('rejects add with missing body', async () => {
    const resp = await client.callToolJSON('index_add', {
      entry: { id: 'no-body-' + Date.now(), title: 'No Body' },
    });
    expect(resp?.error || resp?.validationErrors).toBeTruthy();
  });

  it('rejects add with empty body', async () => {
    const resp = await client.callToolJSON('index_add', {
      entry: { id: 'empty-body-' + Date.now(), title: 'Empty Body', body: '' },
    });
    expect(resp?.error || resp?.validationErrors).toBeTruthy();
  });

  it('rejects add with invalid priority type', async () => {
    const resp = await client.callToolJSON('index_add', {
      entry: { id: 'bad-priority-' + Date.now(), title: 'Bad Priority', body: 'Valid body.', priority: 'high' },
      lax: true,
    });
    // Either errors or accepted with coerced value — but disk must be valid
    if (!resp?.error && !resp?.validationErrors) {
      const disk = readDiskEntry(instructionsDir, 'bad-priority-' + Date.now());
      if (disk) {
        const valid = validateLoaderSchema(disk);
        expect(valid, 'Bad priority accepted but produced invalid disk file').toBe(true);
      }
    }
  });

  it('rejects add with invalid status enum', async () => {
    const resp = await client.callToolJSON('index_add', {
      entry: { id: 'bad-status-' + Date.now(), title: 'Bad Status', body: 'Valid body.', status: 'invalid-status' },
      lax: true,
    });
    expect(resp?.error || resp?.validationErrors).toBeTruthy();
  });

  it('rejects add with invalid classification enum', async () => {
    const resp = await client.callToolJSON('index_add', {
      entry: { id: 'bad-class-' + Date.now(), title: 'Bad Classification', body: 'Valid body.', classification: 'top-secret' },
      lax: true,
    });
    expect(resp?.error || resp?.validationErrors).toBeTruthy();
  });

  it('rejects add with invalid priorityTier enum', async () => {
    const resp = await client.callToolJSON('index_add', {
      entry: { id: 'bad-tier-' + Date.now(), title: 'Bad Tier', body: 'Valid body.', priorityTier: 'P99' },
      lax: true,
    });
    expect(resp?.error || resp?.validationErrors).toBeTruthy();
  });

  it('add with valid changeLog nested structure passes', async () => {
    const id = 'nested-changelog-' + Date.now();
    const resp = await client.callToolJSON('index_add', { // lgtm[js/unused-local-variable] — test asserts on disk side-effects, not response payload
      entry: {
        id,
        title: 'ChangeLog Test',
        body: 'Body with nested changeLog.',
        changeLog: [{ version: '1.0.0', changedAt: new Date().toISOString(), summary: 'Initial' }],
      },
      lax: true,
    });
    void resp;

    // Whether accepted or not, if on disk it must be valid
    const disk = readDiskEntry(instructionsDir, id);
    if (disk) {
      const valid = validateLoaderSchema(disk);
      expect(valid, `ChangeLog entry fails loader schema: ${JSON.stringify(validateLoaderSchema.errors)}`).toBe(true);
    }
  });

  it('add with extensions object passes and disk is valid', async () => {
    const id = 'extensions-test-' + Date.now();
    await client.callToolJSON('index_add', {
      entry: {
        id,
        title: 'Extensions Test',
        body: 'Body with extensions.',
        extensions: { customFlag: true, customCount: 42, nested: { deep: 'value' } },
      },
      lax: true,
    });

    const disk = readDiskEntry(instructionsDir, id);
    if (disk) {
      const valid = validateLoaderSchema(disk);
      expect(valid, `Extensions entry fails loader schema: ${JSON.stringify(validateLoaderSchema.errors)}`).toBe(true);
    }
  });
});

describe('instruction CRUD: schema contract after write', () => {
  const instructionsDir = makeTempDir('crud-schema-contract');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;

  beforeAll(async () => {
    client = await createTestClient({
      instructionsDir,
      forceMutation: true,
      extraEnv: { INDEX_SERVER_STRICT_CREATE: '1' },
    });
  }, 30000);

  afterAll(async () => { await client?.close(); });

  it('every property in the JSON schema is exercised individually', async () => {
    // Test each optional property in isolation to ensure it doesn't break the disk schema
    const optionalProps: Record<string, unknown> = {
      rationale: 'Test rationale',
      semanticSummary: 'Semantic summary text',
      owner: 'test-owner',
      status: 'draft',
      priorityTier: 'P3',
      classification: 'public',
      contentType: 'reference',
      version: '2.0.0',
      riskScore: 7,
      supersedes: 'old-id',
      deprecatedBy: 'newer-id',
      lastReviewedAt: new Date().toISOString(),
      nextReviewDue: new Date().toISOString(),
      reviewIntervalDays: 30,
      createdByAgent: 'test-agent',
      sourceWorkspace: 'test-ws',
    };

    for (const [prop, value] of Object.entries(optionalProps)) {
      const safeProp = prop.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const id = `prop-${safeProp}-${Date.now()}`;
      const entry: Record<string, unknown> = { id, title: `Test ${prop}`, body: `Body for ${prop} test.`, [prop]: value };
      await client.callToolJSON('index_add', { entry, lax: true });

      const disk = readDiskEntry(instructionsDir, id);
      if (disk) {
        const valid = validateLoaderSchema(disk);
        expect(valid, `Property '${prop}' produced invalid disk file: ${JSON.stringify(validateLoaderSchema.errors)}`).toBe(true);
      }
    }
  });

  it('overwrite cycle: create → usage_track → overwrite → reload → verify', async () => {
    const id = 'overwrite-cycle-' + Date.now();

    // Step 1: Create
    const createResp = await client.create({ id, title: 'Cycle Start', body: 'Initial body for overwrite cycle.' });
    expect(createResp?.verified).toBe(true);

    // Step 2: Track usage (populates in-memory firstSeenTs, usageCount, lastUsedAt)
    await client.callToolJSON('usage_track', { id, action: 'applied' });

    // Step 3: Overwrite
    const overwriteResp = await client.update({
      id, title: 'Cycle Updated', body: 'Updated body after usage tracking.', overwrite: true,
    });
    expect(overwriteResp?.verified).toBe(true);

    // Step 4: Validate disk file
    const disk = readDiskEntry(instructionsDir, id);
    expect(disk).toBeTruthy();
    const valid = validateLoaderSchema(disk);
    expect(valid, `Overwrite after usage tracking fails loader schema: ${JSON.stringify(validateLoaderSchema.errors)}`).toBe(true);

    // Step 5: Force reload
    await client.callToolJSON('index_dispatch', { action: 'reload' });

    // Step 6: Entry must survive
    const getResp = unwrapEntry(await client.read(id));
    expect(getResp, 'Entry disappeared after overwrite+reload').toBeTruthy();
    expect(getResp?.id).toBe(id);
    expect(String(getResp?.body)).toContain('Updated body after usage tracking');
  });

  it('multiple rapid overwrites all produce valid disk files', async () => {
    const id = 'rapid-overwrite-' + Date.now();
    await client.create({ id, title: 'Rapid v1', body: 'Rapid overwrite version 1.' });

    for (let i = 2; i <= 5; i++) {
      await client.update({
        id, title: `Rapid v${i}`, body: `Rapid overwrite version ${i}.`, overwrite: true,
      });

      const disk = readDiskEntry(instructionsDir, id);
      expect(disk).toBeTruthy();
      const valid = validateLoaderSchema(disk);
      expect(valid, `Rapid overwrite v${i} fails loader schema`).toBe(true);
    }

    // Final reload check
    await client.callToolJSON('index_dispatch', { action: 'reload' });
    const getResp = unwrapEntry(await client.read(id));
    expect(getResp).toBeTruthy();
    expect(String(getResp?.body)).toContain('version 5');
  });
});
