/**
 * Round-trip reload survival test for index_add.
 *
 * This test catches the root cause of issue #205: the instruction JSON
 * schema file (schemas/instruction.schema.json) must be in sync with
 * the TypeScript schema (src/schemas/index.ts). When properties like
 * firstSeenTs exist in the TS schema but not in the JSON schema, files
 * pass write-time validation but are silently rejected by the loader
 * on reload (because additionalProperties: false).
 *
 * Test strategy:
 *  1. Create instruction via index_add → succeeds
 *  2. Manually inject firstSeenTs into the on-disk JSON (simulating
 *     what happens when usage tracking sets it in memory and an overwrite
 *     persists it)
 *  3. Force full reload from disk
 *  4. Verify entry is still in the index
 *
 * Also tests schema parity between the three sources of truth.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTestClient } from './helpers/mcpTestClient.js';

function makeTempDir() {
  const dir = path.join(process.cwd(), 'tmp', 'round-trip-reload-survival');
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

describe('index_add round-trip: reload survival (#205)', () => {
  const instructionsDir = makeTempDir();
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

  // Helper to unwrap get response (may be { item: { id, body } } or { id, body })
  function unwrapEntry(resp: Record<string, unknown> | undefined) {
    if (!resp) return undefined;
    if (resp.item && typeof resp.item === 'object') return resp.item as Record<string, unknown>;
    if (resp.id) return resp;
    return undefined;
  }

  it('instruction survives reload without firstSeenTs', async () => {
    const id = 'roundtrip-clean-' + Date.now();
    const body = 'Clean round-trip test body';
    const title = 'Round Trip Clean';

    // Step 1: Create
    const resp = await client.create({ id, title, body });
    expect(resp?.id).toBe(id);
    expect(resp?.created || resp?.overwritten).toBeTruthy();

    // Step 2: Verify file on disk
    const filePath = path.join(instructionsDir, `${id}.json`);
    expect(fs.existsSync(filePath)).toBe(true);

    // Step 3: Force reload
    const reloadResp = await client.callToolJSON('index_dispatch', { action: 'reload' });
    expect(reloadResp?.reloaded).toBe(true);

    // Step 4: Verify entry still in index after reload
    const getResp = unwrapEntry(await client.read(id));
    expect(getResp).toBeTruthy();
    expect(getResp?.id).toBe(id);
    expect(String(getResp?.body)).toContain('Clean round-trip test body');
  });

  it('instruction with firstSeenTs survives reload (#205 regression)', async () => {
    const id = 'roundtrip-firstseen-' + Date.now();
    const body = 'firstSeenTs round-trip test body';
    const title = 'Round Trip FirstSeen';

    // Step 1: Create instruction
    const resp = await client.create({ id, title, body });
    expect(resp?.id).toBe(id);
    expect(resp?.created || resp?.overwritten).toBeTruthy();

    // Step 2: Inject firstSeenTs into the on-disk file (simulates usage
    // tracking setting it in memory then an overwrite persisting it)
    const filePath = path.join(instructionsDir, `${id}.json`);
    expect(fs.existsSync(filePath)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    onDisk.firstSeenTs = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(onDisk, null, 2), 'utf8'); // lgtm[js/file-system-race] — test deliberately mutates fixture on disk; race acceptable in test infra

    // Step 3: Force full reload from disk
    const reloadResp = await client.callToolJSON('index_dispatch', { action: 'reload' });
    expect(reloadResp?.reloaded).toBe(true);

    // Step 4: THE CRITICAL CHECK — entry must still be in index
    const getResp = unwrapEntry(await client.read(id));
    expect(getResp).toBeTruthy();
    expect(getResp?.id).toBe(id);
    expect(String(getResp?.body)).toContain('firstSeenTs round-trip test body');
  });

  it('instruction with archivedAt survives reload', async () => {
    const id = 'roundtrip-archived-' + Date.now();
    const body = 'archivedAt round-trip test body';
    const title = 'Round Trip ArchivedAt';

    const resp = await client.create({ id, title, body });
    expect(resp?.id).toBe(id);

    // Inject archivedAt
    const filePath = path.join(instructionsDir, `${id}.json`);
    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    onDisk.archivedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(onDisk, null, 2), 'utf8');

    const reloadResp = await client.callToolJSON('index_dispatch', { action: 'reload' });
    expect(reloadResp?.reloaded).toBe(true);

    const getResp = unwrapEntry(await client.read(id));
    expect(getResp).toBeTruthy();
    expect(getResp?.id).toBe(id);
    expect(String(getResp?.body)).toContain('archivedAt round-trip test body');
  });

  it('instruction with ALL optional properties survives reload', async () => {
    const id = 'roundtrip-all-props-' + Date.now();
    const body = 'All properties round-trip test body';
    const title = 'Round Trip All Properties';

    const resp = await client.create({ id, title, body });
    expect(resp?.id).toBe(id);

    // Inject every optional property that has caused issues
    const filePath = path.join(instructionsDir, `${id}.json`);
    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    onDisk.firstSeenTs = new Date().toISOString();
    onDisk.archivedAt = new Date().toISOString();
    onDisk.usageCount = 5;
    onDisk.lastUsedAt = new Date().toISOString();
    onDisk.createdByAgent = 'promote_from_repo';
    onDisk.sourceWorkspace = 'test-workspace';
    fs.writeFileSync(filePath, JSON.stringify(onDisk, null, 2), 'utf8');

    const reloadResp = await client.callToolJSON('index_dispatch', { action: 'reload' });
    expect(reloadResp?.reloaded).toBe(true);

    const getResp = unwrapEntry(await client.read(id));
    expect(getResp).toBeTruthy();
    expect(getResp?.id).toBe(id);
    expect(String(getResp?.body)).toContain('All properties round-trip test body');
  });
});

describe('JSON schema / TS schema property parity', () => {
  it('instruction.schema.json properties must be a superset of src/schemas/index.ts properties', async () => {
    // Load JSON schema
    const jsonSchemaPath = path.join(process.cwd(), 'schemas', 'instruction.schema.json');
    const jsonSchema = JSON.parse(fs.readFileSync(jsonSchemaPath, 'utf8'));
    const jsonProps = new Set(Object.keys(jsonSchema.properties || {}));

    // Load TS schema by importing the source module
    const tsSchemaModule = await import('../schemas/index.js');
    const tsSchemaProps = new Set(Object.keys(tsSchemaModule.instructionEntry.properties || {}));

    // Every property in the TS schema must also be in the JSON schema
    const missingInJson: string[] = [];
    for (const prop of tsSchemaProps) {
      if (!jsonProps.has(prop)) {
        missingInJson.push(prop);
      }
    }

    expect(missingInJson, `Properties in src/schemas/index.ts but missing from schemas/instruction.schema.json: ${missingInJson.join(', ')}`).toEqual([]);
  });

  it('InstructionEntry model fields should be covered by JSON schema', () => {
    // Read the TypeScript model source to extract interface fields
    const modelPath = path.join(process.cwd(), 'src', 'models', 'instruction.ts');
    const modelSource = fs.readFileSync(modelPath, 'utf8');

    // Extract field names from the interface (lines matching `fieldName:` or `fieldName?:`)
    const fieldRegex = /^\s+(\w+)\??:\s/gm;
    const modelFields = new Set<string>();
    let match;
    while ((match = fieldRegex.exec(modelSource)) !== null) {
      modelFields.add(match[1]);
    }

    // Load JSON schema
    const jsonSchemaPath = path.join(process.cwd(), 'schemas', 'instruction.schema.json');
    const jsonSchema = JSON.parse(fs.readFileSync(jsonSchemaPath, 'utf8'));
    const jsonProps = new Set(Object.keys(jsonSchema.properties || {}));

    const missingInJson: string[] = [];
    for (const field of modelFields) {
      if (!jsonProps.has(field)) {
        missingInJson.push(field);
      }
    }

    expect(missingInJson, `Fields in InstructionEntry model but missing from JSON schema: ${missingInJson.join(', ')}`).toEqual([]);
  });
});
