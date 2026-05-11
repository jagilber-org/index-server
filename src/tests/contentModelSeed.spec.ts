import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
// hallucination-allowlist: AJV publishes this draft-07 meta-schema path.
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';
import schema from '../../schemas/instruction.schema.json';
import { autoSeedBootstrap, _getCanonicalSeeds } from '../services/seedBootstrap';
import { buildContentModelSeed } from '../services/seedBootstrap.contentModel';
import { reloadRuntimeConfig } from '../config/runtimeConfig';

/**
 * Tests for the build-derived "content model" canonical seed.
 *
 * Design contract (must hold across schema edits):
 *  - seed id: 002-content-model
 *  - contentType: 'knowledge'
 *  - body is generated from schemas/instruction.schema.json (single source of truth)
 *  - every contentType enum member from the schema appears verbatim in the body
 *  - every required field from the schema appears in the body
 *  - the seed validates against the canonical schema (drift trip-wire)
 */

function makeTempDir(): string {
  const base = path.join(process.cwd(), 'tmp', 'test-runs');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, 'mcp-content-model-seed-'));
}

function makeAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  try {
    const httpsIdNoHash = 'https://json-schema.org/draft-07/schema';
    const httpsIdHash = 'https://json-schema.org/draft-07/schema#';
    if (!ajv.getSchema(httpsIdNoHash)) ajv.addMetaSchema({ ...draft7MetaSchema, $id: httpsIdNoHash });
    if (!ajv.getSchema(httpsIdHash)) ajv.addMetaSchema({ ...draft7MetaSchema, $id: httpsIdHash });
  } catch { /* ignore meta-schema reg issues */ }
  return ajv;
}

describe('contentModelSeed (002-content-model)', () => {
  beforeEach(() => {
    delete process.env.INDEX_SERVER_AUTO_SEED;
    delete process.env.INDEX_SERVER_SEED_VERBOSE;
    reloadRuntimeConfig();
  });

  it('is registered in CANONICAL_SEEDS', () => {
    const seeds = _getCanonicalSeeds();
    const ids = seeds.map(s => s.id);
    expect(ids).toContain('002-content-model');
    const entry = seeds.find(s => s.id === '002-content-model')!;
    expect(entry.file).toBe('002-content-model.json');
  });

  it('builds a schema-valid InstructionEntry', () => {
    const seed = buildContentModelSeed();
    expect(seed.id).toBe('002-content-model');
    expect(seed.json.contentType).toBe('knowledge');
    const ajv = makeAjv();
    const validate = ajv.compile(JSON.parse(JSON.stringify(schema)));
    const ok = validate(seed.json);
    if (!ok) {
      throw new Error(`content-model seed failed schema: ${JSON.stringify(validate.errors, null, 2)}`);
    }
  });

  it('body lists every contentType enum member from the schema (drift trip-wire)', () => {
    const seed = buildContentModelSeed();
    const body = seed.json.body as string;
    const enumValues = (schema as { properties: { contentType: { enum: string[] } } })
      .properties.contentType.enum;
    expect(enumValues.length).toBeGreaterThan(0);
    for (const v of enumValues) {
      // expect inline-code occurrence so the body remains parseable/searchable
      expect(body).toContain(`\`${v}\``);
    }
  });

  it('body references every required field from the schema (drift trip-wire)', () => {
    const seed = buildContentModelSeed();
    const body = seed.json.body as string;
    const required = (schema as { required: string[] }).required;
    expect(required.length).toBeGreaterThan(0);
    for (const r of required) {
      expect(body).toContain(`\`${r}\``);
    }
  });

  it('body points agents to the live index_schema tool for full schema', () => {
    const seed = buildContentModelSeed();
    const body = seed.json.body as string;
    expect(body).toContain('index_schema');
  });

  it('contentType matrix has no fallback "(no description in schema)" rows', () => {
    // Trip-wire for structural rewrites of the schema description (e.g.
    // moving from `name (desc)` prose to oneOf / structured form). If the
    // regex stops matching, parseContentTypeMatrix falls back to the
    // sentinel string — this assertion forces a code update before the
    // seed silently degrades.
    const seed = buildContentModelSeed();
    const body = seed.json.body as string;
    expect(body).not.toContain('(no description in schema)');
  });

  it('schemaVersion is read from the schema enum (not hardcoded)', () => {
    const seed = buildContentModelSeed();
    const enumValues = (schema as { properties: { schemaVersion: { enum: string[] } } })
      .properties.schemaVersion.enum;
    expect(enumValues).toContain((seed.json as { schemaVersion: string }).schemaVersion);
  });

  it('common-optional field descriptions are sourced from the schema', () => {
    const seed = buildContentModelSeed();
    const body = seed.json.body as string;
    const props = (schema as { properties: Record<string, { description?: string }> }).properties;
    // Sample a few schema-described optional fields. Their schema
    // descriptions must appear in the body verbatim.
    for (const f of ['semanticSummary', 'priorityTier', 'rationale', 'classification']) {
      const desc = props[f]?.description;
      expect(desc, `schema.${f}.description must exist`).toBeTruthy();
      expect(body).toContain(desc as string);
    }
  });

  it('autoSeedBootstrap writes the content-model seed to disk', () => {
    const dir = makeTempDir();
    process.env.INDEX_SERVER_DIR = dir;
    const summary = autoSeedBootstrap();
    expect(summary.disabled).toBe(false);
    expect(summary.created).toContain('002-content-model.json');
    const written = JSON.parse(fs.readFileSync(path.join(dir, '002-content-model.json'), 'utf8'));
    expect(written.id).toBe('002-content-model');
    expect(written.contentType).toBe('knowledge');
    expect(typeof written.sourceHash).toBe('string');
    expect(written.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('built seed is deterministic (pure function of the schema)', () => {
    const a = buildContentModelSeed();
    const b = buildContentModelSeed();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('refreshes an existing on-disk seed when its sourceHash drifts from the canonical body', () => {
    // Reviewer concern (PR #324, quality): the previous bootstrap path
    // skipped any existing valid seed, so a schema edit could leave the
    // 002-content-model file stale on disk forever — silently violating
    // the documented single-source-of-truth contract. This test pins the
    // refresh-on-drift behavior introduced to close that gap.
    const dir = makeTempDir();
    process.env.INDEX_SERVER_DIR = dir;
    // First write: canonical content lands on disk.
    const first = autoSeedBootstrap();
    expect(first.created).toContain('002-content-model.json');
    const target = path.join(dir, '002-content-model.json');
    const original = JSON.parse(fs.readFileSync(target, 'utf8'));
    // Simulate prior-version drift: rewrite the file with a stale body
    // and a sourceHash that no longer matches the current canonical body.
    const drifted = {
      ...original,
      body: '# stale content from a prior schema version\n',
      sourceHash: 'deadbeef'.repeat(8) // 64 hex chars, well-formed but wrong
    };
    fs.writeFileSync(target, JSON.stringify(drifted, null, 2), 'utf8');
    // Second bootstrap: must detect the sourceHash mismatch and refresh.
    const second = autoSeedBootstrap();
    expect(second.upgraded).toContain('002-content-model.json');
    const refreshed = JSON.parse(fs.readFileSync(target, 'utf8'));
    expect(refreshed.body).toBe(original.body);
    expect(refreshed.sourceHash).toBe(original.sourceHash);
  });

  it('refreshes a legacy on-disk seed that has no sourceHash field', () => {
    // Reviewer concern (PR #324, reliability LOW): a stale canonical seed
    // written by a pre-sourceHash Index Server version would skip the
    // hash-mismatch check (sourceHash absent → string-type guard fails)
    // and persist forever. Pin the convergence-on-canonical behavior for
    // legacy installs.
    const dir = makeTempDir();
    process.env.INDEX_SERVER_DIR = dir;
    const first = autoSeedBootstrap();
    expect(first.created).toContain('002-content-model.json');
    const target = path.join(dir, '002-content-model.json');
    const original = JSON.parse(fs.readFileSync(target, 'utf8'));
    // Simulate legacy pre-sourceHash install: stale body and no
    // sourceHash field on disk.
    const legacy = { ...original, body: '# legacy stale body\n' };
    delete legacy.sourceHash;
    fs.writeFileSync(target, JSON.stringify(legacy, null, 2), 'utf8');
    const second = autoSeedBootstrap();
    expect(second.upgraded).toContain('002-content-model.json');
    const refreshed = JSON.parse(fs.readFileSync(target, 'utf8'));
    expect(refreshed.body).toBe(original.body);
    expect(refreshed.sourceHash).toBe(original.sourceHash);
  });
});
