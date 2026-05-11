import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  INPUT_SCHEMA,
  RECORD_PROPERTY_KEYS,
  INPUT_KEYS,
  SERVER_MANAGED_KEYS,
  REQUIRED_RECORD_KEYS,
  REQUIRED_INPUT_KEYS,
  splitEntry,
  validateRecord,
  validateInput,
} from '../schemas/instructionSchema';

/**
 * Source-of-truth contract guardrails.
 *
 * If any of these tests start failing, the canonical schema and one of its
 * derived consumers have drifted apart. DO NOT loosen the assertions: instead,
 * either annotate the new property in schemas/instruction.schema.json with
 * `x-fieldClass: "server-managed"` (if the server owns it) or update the
 * canonical required[] list. Every CRUD/import/export/migration/repair path
 * must read from src/schemas/instructionSchema.ts.
 */
describe('instruction schema — single source of truth', () => {
  const canonicalPath = path.join(process.cwd(), 'schemas', 'instruction.schema.json');
  const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));

  it('RECORD_PROPERTY_KEYS matches the canonical properties', () => {
    const props = new Set(Object.keys(canonical.properties || {}));
    expect(new Set(RECORD_PROPERTY_KEYS)).toEqual(props);
  });

  it('INPUT_KEYS ∪ SERVER_MANAGED_KEYS equals RECORD_PROPERTY_KEYS', () => {
    const union = new Set<string>([...INPUT_KEYS, ...SERVER_MANAGED_KEYS]);
    expect(union).toEqual(new Set(RECORD_PROPERTY_KEYS));
  });

  it('INPUT_KEYS and SERVER_MANAGED_KEYS are disjoint', () => {
    const overlap = [...INPUT_KEYS].filter((k) => SERVER_MANAGED_KEYS.has(k));
    expect(overlap).toEqual([]);
  });

  it('REQUIRED_RECORD_KEYS equals canonical required[]', () => {
    expect(new Set(REQUIRED_RECORD_KEYS)).toEqual(new Set(canonical.required || []));
  });

  it('REQUIRED_INPUT_KEYS is required minus server-managed', () => {
    const expected = new Set([...REQUIRED_RECORD_KEYS].filter((k) => !SERVER_MANAGED_KEYS.has(k)));
    expect(new Set(REQUIRED_INPUT_KEYS)).toEqual(expected);
  });

  it('INPUT_SCHEMA forbids server-managed properties via additionalProperties:false', () => {
    expect(INPUT_SCHEMA.additionalProperties).toBe(false);
    for (const key of SERVER_MANAGED_KEYS) {
      expect((INPUT_SCHEMA.properties as Record<string, unknown>)[key]).toBeUndefined();
    }
  });

  it('splitEntry partitions a full record into {input, serverManaged, unknown}', () => {
    const fullRecord: Record<string, unknown> = {
      id: 'sot-test-1',
      title: 'sot test',
      body: 'body',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['test'],
      contentType: 'instruction',
      // server-managed:
      schemaVersion: '1.0.0',
      sourceHash: 'abc',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      usageCount: 5,
      firstSeenTs: '2024-01-01T00:00:00.000Z',
      lastUsedAt: '2024-01-02T00:00:00.000Z',
      // unknown:
      bogus: 'should be flagged unknown',
    };
    const { input, serverManaged, unknown } = splitEntry(fullRecord);
    expect(Object.keys(input).sort()).toEqual(
      ['audience', 'body', 'categories', 'contentType', 'id', 'priority', 'requirement', 'title'].sort()
    );
    expect(Object.keys(serverManaged).sort()).toEqual(
      ['createdAt', 'firstSeenTs', 'lastUsedAt', 'schemaVersion', 'sourceHash', 'updatedAt', 'usageCount'].sort()
    );
    expect(unknown).toEqual({ bogus: 'should be flagged unknown' });
  });

  it('export → splitEntry → input slice validates against INPUT_SCHEMA', () => {
    const exportedEntry: Record<string, unknown> = {
      id: 'sot-test-2',
      title: 'export round-trip',
      body: 'body',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['x'],
      contentType: 'instruction',
      // server-managed (would have been rejected by old hardcoded allowlist):
      schemaVersion: '6',
      sourceHash: 'a'.repeat(64),
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    // RECORD validation passes for full export
    const recordOk = validateRecord(exportedEntry);
    if (!recordOk) {
      throw new Error('RECORD_SCHEMA rejected export: ' + JSON.stringify(validateRecord.errors));
    }
    expect(recordOk).toBe(true);
    // INPUT validation passes for input slice (server-managed stripped)
    const { input } = splitEntry(exportedEntry);
    const inputOk = validateInput(input);
    if (!inputOk) {
      throw new Error('INPUT_SCHEMA rejected slice: ' + JSON.stringify(validateInput.errors));
    }
    expect(inputOk).toBe(true);
  });

  it('TypeScript InstructionEntry interface keys are a subset of RECORD_PROPERTY_KEYS (or transient extras)', () => {
    const modelPath = path.join(process.cwd(), 'src', 'models', 'instruction.ts');
    const source = fs.readFileSync(modelPath, 'utf8');
    const fieldRegex = /^\s+(\w+)\??:\s/gm;
    const modelFields = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = fieldRegex.exec(source)) !== null) modelFields.add(m[1]);
    const missing = [...modelFields].filter((f) => !RECORD_PROPERTY_KEYS.has(f));
    // Drift here means the TS interface added a field that isn't in the canonical
    // schema. Add it to schemas/instruction.schema.json with the right
    // x-fieldClass annotation, or remove it from the interface.
    expect(missing).toEqual([]);
  });

  it('tool-registry input schemas for index_add/index_import derive from canonical INPUT_SCHEMA', async () => {
    // Force-load the registry module (registers tools and freezes INPUT_SCHEMAS).
    const reg = await import('../services/toolRegistry.js');
    const tools = reg.getToolRegistry({ tier: 'admin' });
    const add = tools.find((t: { name: string }) => t.name === 'index_add');
    const importTool = tools.find((t: { name: string }) => t.name === 'index_import');
    expect(add, 'index_add must be registered').toBeTruthy();
    expect(importTool, 'index_import must be registered').toBeTruthy();

    type SchemaObj = Record<string, unknown> & { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
    const addEntry = ((add!.inputSchema as SchemaObj).properties as Record<string, SchemaObj>).entry;
    const importItems = (((importTool!.inputSchema as SchemaObj).properties as Record<string, SchemaObj>).entries as SchemaObj & { oneOf?: SchemaObj[] }).oneOf?.find((o) => o.type === 'array') as SchemaObj & { items?: SchemaObj };
    const importEntry = importItems!.items as SchemaObj;

    // Both registry surfaces must reject server-managed properties.
    expect(addEntry.additionalProperties).toBe(false);
    expect(importEntry.additionalProperties).toBe(false);
    for (const key of SERVER_MANAGED_KEYS) {
      expect((addEntry.properties as Record<string, unknown>)[key], `index_add must not advertise ${key}`).toBeUndefined();
      expect((importEntry.properties as Record<string, unknown>)[key], `index_import must not advertise ${key}`).toBeUndefined();
    }

    // Property names exposed by the registry must be a subset of INPUT_KEYS
    // (no rogue extras). Caller-required minimums differ per tool but each
    // required key must still be a valid INPUT_KEY.
    for (const key of Object.keys(addEntry.properties || {})) {
      expect(INPUT_KEYS.has(key), `index_add advertises non-input key ${key}`).toBe(true);
    }
    for (const key of Object.keys(importEntry.properties || {})) {
      expect(INPUT_KEYS.has(key), `index_import advertises non-input key ${key}`).toBe(true);
    }
    for (const req of (addEntry.required || [])) {
      expect(INPUT_KEYS.has(req), `index_add required key ${req} not in INPUT_KEYS`).toBe(true);
      expect(SERVER_MANAGED_KEYS.has(req), `index_add required key ${req} is server-managed`).toBe(false);
    }
    for (const req of (importEntry.required || [])) {
      expect(INPUT_KEYS.has(req), `index_import required key ${req} not in INPUT_KEYS`).toBe(true);
      expect(SERVER_MANAGED_KEYS.has(req), `index_import required key ${req} is server-managed`).toBe(false);
    }
  });

  it('index_schema handler exposes requiredFields/optionalFieldsCommon derived from canonical', async () => {
    await import('../services/handlers.instructionSchema.js');
    const { getHandler } = await import('../server/registry.js');
    const handler = getHandler('index_schema');
    expect(handler).toBeTruthy();
    const result = await Promise.resolve(handler!({})) as Record<string, unknown>;
    const requiredFields = result.requiredFields as string[];
    const optionalFieldsCommon = result.optionalFieldsCommon as string[];

    // Required must equal REQUIRED_INPUT_KEYS.
    expect(new Set(requiredFields)).toEqual(new Set([...REQUIRED_INPUT_KEYS]));
    // Optional must equal INPUT_KEYS \ REQUIRED_INPUT_KEYS \ SERVER_MANAGED_KEYS.
    const expectedOptional = [...INPUT_KEYS].filter(
      (k) => !REQUIRED_INPUT_KEYS.has(k) && !SERVER_MANAGED_KEYS.has(k)
    );
    expect(new Set(optionalFieldsCommon)).toEqual(new Set(expectedOptional));
    // Sanity: no server-managed leaks.
    for (const key of SERVER_MANAGED_KEYS) {
      expect(requiredFields).not.toContain(key);
      expect(optionalFieldsCommon).not.toContain(key);
    }

    // index_schema must clearly separate input-only example from full
    // record example, and tag every validation rule by canonical field
    // class so the self-doc surface cannot drift from the validation
    // surface.
    const minimalExample = result.minimalExample as Record<string, unknown>;
    expect(minimalExample, 'minimalExample present').toBeTruthy();
    for (const key of Object.keys(minimalExample)) {
      expect(INPUT_KEYS.has(key), `minimalExample must be input-only, found ${key}`).toBe(true);
      expect(SERVER_MANAGED_KEYS.has(key), `minimalExample must not include server-managed key ${key}`).toBe(false);
    }

    const recordExample = result.recordExample as Record<string, unknown>;
    expect(recordExample, 'recordExample present').toBeTruthy();
    // recordExample must demonstrate the full lifecycle by including at
    // least one server-managed field — that's the entire point of having
    // the separate example.
    const recordKeys = new Set(Object.keys(recordExample));
    const hasServerManaged = [...SERVER_MANAGED_KEYS].some((k) => recordKeys.has(k));
    expect(hasServerManaged, 'recordExample must include server-managed fields').toBe(true);

    const validationRules = result.validationRules as { field: string; fieldClass: 'input' | 'server-managed' }[];
    for (const rule of validationRules) {
      const expected = SERVER_MANAGED_KEYS.has(rule.field) ? 'server-managed' : 'input';
      expect(
        rule.fieldClass,
        `validationRules entry for '${rule.field}' must declare fieldClass='${expected}'`,
      ).toBe(expected);
    }
  });

  it('runtime Zod validator for index_add/index_import accepts every canonical INPUT_KEY', async () => {
    // The default transport validation path (validation mode = 'zod') runs
    // the Zod schema BEFORE the handler. If it rejects a field that the
    // canonical INPUT_SCHEMA accepts, the source-of-truth contract is broken
    // for the runtime path even when the JSON-Schema registry advertises the
    // field correctly. This guard derives the Zod entry shape directly from
    // INPUT_KEYS so it cannot drift.
    const { getZodSchema } = await import('../services/toolRegistry.zod.js');
    const addSchema = getZodSchema('index_add');
    const importSchema = getZodSchema('index_import');
    expect(addSchema, 'index_add must have a Zod schema').toBeTruthy();
    expect(importSchema, 'index_import must have a Zod schema').toBeTruthy();

    // Sample values keyed by canonical input field. Each value must satisfy
    // the canonical INPUT_SCHEMA refinements (and thus the derived Zod
    // refinements). For canonical fields not yet enumerated here, fall back
    // to a string — `buildEntryShape()` accepts unknown for any field
    // missing from the typed-refinement map.
    const sampleByKey: Record<string, unknown> = {
      id: 'sot-zod-1',
      title: 'sot zod',
      body: 'body content',
      rationale: 'because',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['x'],
      primaryCategory: 'x',
      contentType: 'instruction',
      status: 'draft',
      priorityTier: 'P3',
      classification: 'internal',
      reviewIntervalDays: 90,
      workspaceId: 'ws-1',
      userId: 'user-1',
      teamIds: ['team-1'],
      supersedes: ['old-id'],
      sourceWorkspace: '/some/repo',
      createdByAgent: 'copilot',
      semanticSummary: 'short summary',
      version: '1.0.0',
      owner: 'platform-team',
      lastReviewedAt: '2024-01-01T00:00:00.000Z',
      nextReviewDue: '2024-04-01T00:00:00.000Z',
      deprecatedBy: 'newer-id',
      riskScore: 0.5,
      changeLog: [{ version: '1.0.0', changedAt: '2024-01-01T00:00:00.000Z', summary: 'initial' }],
      extensions: { foo: 'bar' },
    };

    for (const key of INPUT_KEYS) {
      // Build a valid baseline entry, then ensure the field under test is
      // present so the Zod schema is forced to evaluate it.
      const sample = sampleByKey[key] ?? 'sample';
      const entry: Record<string, unknown> = {
        id: 'sot-zod-1',
        title: 'sot zod',
        body: 'body content',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['x'],
        contentType: 'instruction',
      };
      entry[key] = sample;

      const addResult = addSchema!.safeParse({ entry });
      expect(
        addResult.success,
        `index_add Zod schema rejected canonical INPUT_KEY '${key}': ${addResult.success ? '' : JSON.stringify(addResult.error.issues)}`,
      ).toBe(true);

      const importResult = importSchema!.safeParse({ entries: [entry] });
      expect(
        importResult.success,
        `index_import Zod schema rejected canonical INPUT_KEY '${key}': ${importResult.success ? '' : JSON.stringify(importResult.error.issues)}`,
      ).toBe(true);
    }
  });

  it('runtime Zod validator rejects server-managed and unknown keys on index_add entry', async () => {
    const { getZodSchema } = await import('../services/toolRegistry.zod.js');
    const addSchema = getZodSchema('index_add');
    const baseEntry = {
      id: 'sot-zod-2',
      title: 'sot zod 2',
      body: 'body content',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['x'],
      contentType: 'instruction',
    };
    // Server-managed keys must not be accepted on input.
    for (const sm of SERVER_MANAGED_KEYS) {
      const r = addSchema!.safeParse({ entry: { ...baseEntry, [sm]: 'x' } });
      expect(r.success, `index_add Zod schema must reject server-managed key '${sm}'`).toBe(false);
    }
    // Wholly unknown keys must be rejected (.strict()).
    const r = addSchema!.safeParse({ entry: { ...baseEntry, totallyUnknownField: 1 } });
    expect(r.success).toBe(false);
  });
});
