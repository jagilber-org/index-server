/**
 * Epic 511: Structured links array (schema v8) — comprehensive test coverage.
 *
 * Covers: TS-6 (new feature), TS-7 (round-trip pipeline), TS-12 (>=5 edge cases).
 * Constitution: Q-1 (unit tests), Q-7 (schema-contract), Q-8 (dispatch schema).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import canonicalSchema from '../../schemas/instruction.schema.json';
import {
  LINK_RELS,
  type LinkRel,
  type InstructionLink,
} from '../models/instruction';
import { SCHEMA_VERSION } from '../versioning/schemaVersion';
import { validateLinks } from '../services/handlers/instructions.shared';
import { getRuntimeConfig, reloadRuntimeConfig } from '../config/runtimeConfig';

// ─── 1. Schema contract (REQ-1..REQ-4) ─────────────────────────────

describe('Schema contract: links property', () => {
  const schema = canonicalSchema as Record<string, unknown>;
  const props = (schema as { properties: Record<string, unknown> }).properties;
  const linksDef = props.links as {
    type: string;
    maxItems: number;
    items: {
      type: string;
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, unknown>;
    };
    description: string;
  };

  it('REQ-1: links property exists and is an array', () => {
    expect(linksDef).toBeDefined();
    expect(linksDef.type).toBe('array');
  });

  it('REQ-1: max 25 items per entry', () => {
    expect(linksDef.maxItems).toBe(25);
  });

  it('REQ-1: each item requires target, has optional rel and label', () => {
    const itemProps = linksDef.items.properties;
    expect(linksDef.items.required).toEqual(['target']);
    expect(itemProps.target).toBeDefined();
    expect(itemProps.rel).toBeDefined();
    expect(itemProps.label).toBeDefined();
  });

  it('REQ-1: additionalProperties false on link items', () => {
    expect(linksDef.items.additionalProperties).toBe(false);
  });

  it('REQ-2: rel enum has exactly the five specified values', () => {
    const relDef = linksDef.items.properties.rel as { enum: string[]; default: string };
    expect(relDef.enum).toEqual(['related', 'prerequisite', 'sequel', 'part-of', 'see-also']);
    expect(relDef.default).toBe('related');
  });

  it('REQ-3: target uses the same ID pattern as root id field', () => {
    const targetDef = linksDef.items.properties.target as { pattern: string; maxLength: number };
    const idDef = props.id as { pattern: string; maxLength: number };
    expect(targetDef.pattern).toBe(idDef.pattern);
    expect(targetDef.maxLength).toBe(idDef.maxLength);
  });

  it('REQ-4: links is NOT server-managed', () => {
    const raw = linksDef as Record<string, unknown>;
    expect(raw['x-fieldClass']).toBeUndefined();
  });

  it('REQ-1: label maxLength is 120', () => {
    const labelDef = linksDef.items.properties.label as { maxLength: number };
    expect(labelDef.maxLength).toBe(120);
  });
});

// ─── 2. Enum parity (REQ-17) ────────────────────────────────────────

describe('Enum parity: LINK_RELS', () => {
  it('REQ-17: LINK_RELS tuple matches JSON schema rel enum', () => {
    const schema = canonicalSchema as Record<string, unknown>;
    const relEnum = ((schema as any).properties.links.items.properties.rel.enum) as string[];
    expect([...LINK_RELS]).toEqual(relEnum);
  });

  it('REQ-17: LINK_RELS has exactly 5 values', () => {
    expect(LINK_RELS).toHaveLength(5);
  });

  it('REQ-17: readNestedSchemaEnum parity guard runs at module load', () => {
    // If this test runs at all, the parity guard in instruction.ts passed at import time.
    // The guard throws if LINK_RELS disagrees with the schema. We verify the import succeeded.
    expect(LINK_RELS).toContain('related');
    expect(LINK_RELS).toContain('prerequisite');
    expect(LINK_RELS).toContain('sequel');
    expect(LINK_RELS).toContain('part-of');
    expect(LINK_RELS).toContain('see-also');
  });
});

// ─── 3. Schema version (REQ-5, REQ-6) ──────────────────────────────

describe('Schema version', () => {
  it('REQ-5: SCHEMA_VERSION is 9', () => {
    expect(SCHEMA_VERSION).toBe('9');
  });

  it('REQ-5: schemaVersion enum in JSON schema includes 9', () => {
    const schema = canonicalSchema as Record<string, unknown>;
    const svEnum = ((schema as any).properties.schemaVersion.enum) as string[];
    expect(svEnum).toContain('9');
  });
});

// ─── 4. validateLinks unit tests (REQ-9..REQ-11) ────────────────────

describe('validateLinks', () => {
  function makeByIdMap(...entries: Array<{ id: string; links?: InstructionLink[] }>): ReadonlyMap<string, unknown> {
    const m = new Map<string, unknown>();
    for (const e of entries) m.set(e.id, e);
    return m;
  }

  describe('Self-referencing link (REQ-9)', () => {
    it('rejects a link whose target equals the entry id', () => {
      const byId = makeByIdMap({ id: 'alpha' });
      const result = validateLinks('alpha', [{ target: 'alpha', rel: 'related' }], byId);
      expect(result.error).toMatch(/self-referencing/i);
      expect(result.links).toHaveLength(0);
    });
  });

  describe('Duplicate dedup (REQ-9)', () => {
    it('deduplicates links with same target + rel', () => {
      const byId = makeByIdMap({ id: 'a' }, { id: 'b' });
      const result = validateLinks('a', [
        { target: 'b', rel: 'related' },
        { target: 'b', rel: 'related' },
        { target: 'b', rel: 'related' },
      ], byId);
      expect(result.error).toBeUndefined();
      expect(result.links).toHaveLength(1);
      expect(result.links[0].target).toBe('b');
    });

    it('keeps links with same target but different rel', () => {
      const byId = makeByIdMap({ id: 'a' }, { id: 'b' });
      const result = validateLinks('a', [
        { target: 'b', rel: 'related' },
        { target: 'b', rel: 'prerequisite' },
      ], byId);
      expect(result.error).toBeUndefined();
      expect(result.links).toHaveLength(2);
    });
  });

  describe('Dead-link warning (REQ-10)', () => {
    it('warns when target does not exist in active index', () => {
      const byId = makeByIdMap({ id: 'a' });
      const result = validateLinks('a', [{ target: 'nonexistent', rel: 'related' }], byId);
      expect(result.error).toBeUndefined();
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toMatch(/dead-link/i);
      expect(result.links).toHaveLength(1);
    });

    it('does not warn when target exists', () => {
      const byId = makeByIdMap({ id: 'a' }, { id: 'b' });
      const result = validateLinks('a', [{ target: 'b', rel: 'related' }], byId);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('Cycle detection (REQ-11)', () => {
    it('rejects prerequisite cycle A→B→C→A', () => {
      const byId = makeByIdMap(
        { id: 'a', links: [{ target: 'b', rel: 'prerequisite' }] },
        { id: 'b', links: [{ target: 'c', rel: 'prerequisite' }] },
        { id: 'c', links: [] },
      );
      // Adding c→a would form a cycle
      const result = validateLinks('c', [{ target: 'a', rel: 'prerequisite' }], byId);
      expect(result.error).toMatch(/cycle.*prerequisite/i);
    });

    it('rejects sequel cycle', () => {
      const byId = makeByIdMap(
        { id: 'x', links: [{ target: 'y', rel: 'sequel' }] },
        { id: 'y', links: [] },
      );
      const result = validateLinks('y', [{ target: 'x', rel: 'sequel' }], byId);
      expect(result.error).toMatch(/cycle.*sequel/i);
    });

    it('rejects part-of cycle', () => {
      const byId = makeByIdMap(
        { id: 'p', links: [{ target: 'q', rel: 'part-of' }] },
        { id: 'q', links: [] },
      );
      const result = validateLinks('q', [{ target: 'p', rel: 'part-of' }], byId);
      expect(result.error).toMatch(/cycle.*part-of/i);
    });

    it('accepts related cycle (A→B→A) — exempt from cycle detection', () => {
      const byId = makeByIdMap(
        { id: 'a', links: [{ target: 'b', rel: 'related' }] },
        { id: 'b', links: [] },
      );
      const result = validateLinks('b', [{ target: 'a', rel: 'related' }], byId);
      expect(result.error).toBeUndefined();
      expect(result.links).toHaveLength(1);
    });

    it('accepts see-also cycle — exempt from cycle detection', () => {
      const byId = makeByIdMap(
        { id: 'a', links: [{ target: 'b', rel: 'see-also' }] },
        { id: 'b', links: [] },
      );
      const result = validateLinks('b', [{ target: 'a', rel: 'see-also' }], byId);
      expect(result.error).toBeUndefined();
      expect(result.links).toHaveLength(1);
    });

    it('cycle error includes the cycle path', () => {
      const byId = makeByIdMap(
        { id: 'a', links: [{ target: 'b', rel: 'prerequisite' }] },
        { id: 'b', links: [{ target: 'c', rel: 'prerequisite' }] },
        { id: 'c', links: [] },
      );
      const result = validateLinks('c', [{ target: 'a', rel: 'prerequisite' }], byId);
      expect(result.error).toContain('a');
      expect(result.error).toContain('b');
      expect(result.error).toContain('→');
    });
  });

  describe('Max items', () => {
    it('accepts exactly 25 links', () => {
      const entries = Array.from({ length: 26 }, (_, i) => ({ id: `t${i}` }));
      const byId = makeByIdMap(...entries);
      const links = Array.from({ length: 25 }, (_, i) => ({ target: `t${i + 1}`, rel: 'related' as const }));
      const result = validateLinks('t0', links, byId);
      expect(result.error).toBeUndefined();
      expect(result.links).toHaveLength(25);
    });

    it('rejects 26 links', () => {
      const entries = Array.from({ length: 28 }, (_, i) => ({ id: `t${i}` }));
      const byId = makeByIdMap(...entries);
      const links = Array.from({ length: 26 }, (_, i) => ({ target: `t${i + 1}`, rel: 'related' as const }));
      const result = validateLinks('t0', links, byId);
      expect(result.error).toMatch(/exceeds maximum.*25/i);
    });
  });

  describe('Empty vs absent', () => {
    it('empty array [] returns empty links', () => {
      const byId = makeByIdMap({ id: 'a' });
      const result = validateLinks('a', [], byId);
      expect(result.error).toBeUndefined();
      expect(result.links).toHaveLength(0);
    });

    it('undefined returns empty links (equivalent semantics)', () => {
      const byId = makeByIdMap({ id: 'a' });
      const result = validateLinks('a', undefined, byId);
      expect(result.error).toBeUndefined();
      expect(result.links).toHaveLength(0);
    });

    it('null returns empty links (equivalent semantics)', () => {
      const byId = makeByIdMap({ id: 'a' });
      const result = validateLinks('a', null, byId);
      expect(result.error).toBeUndefined();
      expect(result.links).toHaveLength(0);
    });
  });

  describe('Invalid rel defaults to related', () => {
    it('unknown rel value is coerced to related', () => {
      const byId = makeByIdMap({ id: 'a' }, { id: 'b' });
      const result = validateLinks('a', [{ target: 'b', rel: 'bogus' }], byId);
      expect(result.error).toBeUndefined();
      expect(result.links[0].rel).toBe('related');
    });

    it('missing rel defaults to related', () => {
      const byId = makeByIdMap({ id: 'a' }, { id: 'b' });
      const result = validateLinks('a', [{ target: 'b' }], byId);
      expect(result.error).toBeUndefined();
      expect(result.links[0].rel).toBe('related');
    });
  });

  describe('Label handling', () => {
    it('preserves label up to 120 chars', () => {
      const byId = makeByIdMap({ id: 'a' }, { id: 'b' });
      const label = 'x'.repeat(120);
      const result = validateLinks('a', [{ target: 'b', rel: 'related', label }], byId);
      expect(result.links[0].label).toBe(label);
    });

    it('truncates label beyond 120 chars', () => {
      const byId = makeByIdMap({ id: 'a' }, { id: 'b' });
      const label = 'x'.repeat(200);
      const result = validateLinks('a', [{ target: 'b', rel: 'related', label }], byId);
      expect(result.links[0].label).toHaveLength(120);
    });
  });
});

// ─── 5. Round-trip integration (DI-4, TS-7) ─────────────────────────
// Uses callToolJSON directly because the test client's normalizeEntry() strips
// non-core fields like links. This ensures links hit the add handler.

describe('Round-trip: links survive write → read', () => {
  let client: Awaited<ReturnType<typeof import('./helpers/mcpTestClient')['createTestClient']>>;
  const DIR = path.join(process.cwd(), 'tmp', 'links-roundtrip-' + process.pid);

  beforeAll(async () => {
    fs.mkdirSync(DIR, { recursive: true });
    const { createTestClient } = await import('./helpers/mcpTestClient.js');
    client = await createTestClient({ instructionsDir: DIR });
  }, 60000);

  afterAll(async () => {
    await client?.close();
    fs.rmSync(DIR, { recursive: true, force: true });
  });

  async function addWithLinks(entry: Record<string, unknown>) {
    return client.callToolJSON('index_dispatch', {
      action: 'add',
      entry: { priority: 50, audience: 'all', requirement: 'optional', categories: [], ...entry },
      overwrite: true,
      lax: true,
    });
  }

  it('TS-7: read(write(record_with_links)) preserves links array', async () => {
    // Create target entries first so links are valid (no dead-link warnings)
    await addWithLinks({ id: 'target-one', title: 'Target One', body: 'First target.' });
    await addWithLinks({ id: 'target-two', title: 'Target Two', body: 'Second target.' });
    await addWithLinks({ id: 'target-three', title: 'Target Three', body: 'Third target.' });

    const links: InstructionLink[] = [
      { target: 'target-one', rel: 'prerequisite', label: 'must read first' },
      { target: 'target-two', rel: 'related' },
      { target: 'target-three', rel: 'see-also', label: 'background context' },
    ];

    const addResult = await addWithLinks({
      id: 'roundtrip-links-test',
      title: 'Round-trip links test',
      body: 'Tests that links survive the full write-read pipeline.',
      links,
    });
    expect((addResult as any)?.error).toBeFalsy();

    const readResult = await client.read('roundtrip-links-test') as Record<string, unknown>;
    const item = (readResult?.item ?? readResult) as Record<string, unknown>;
    expect(item.id).toBe('roundtrip-links-test');
    expect(item.links).toBeDefined();
    const stored = item.links as InstructionLink[];
    expect(stored).toHaveLength(3);

    expect(stored[0].target).toBe('target-one');
    expect(stored[0].rel).toBe('prerequisite');
    expect(stored[0].label).toBe('must read first');

    expect(stored[1].target).toBe('target-two');
    expect(stored[1].rel).toBe('related');

    expect(stored[2].target).toBe('target-three');
    expect(stored[2].rel).toBe('see-also');
    expect(stored[2].label).toBe('background context');
  });

  it('TS-7: round-trip preserves links after overwrite', async () => {
    // Create targets first
    await addWithLinks({ id: 'dep-a', title: 'Dep A', body: 'Dependency A.' });
    await addWithLinks({ id: 'dep-b', title: 'Dep B', body: 'Dependency B.' });
    await addWithLinks({ id: 'dep-c', title: 'Dep C', body: 'Dependency C.' });

    await addWithLinks({
      id: 'roundtrip-overwrite',
      title: 'Overwrite test',
      body: 'Original body.',
      links: [{ target: 'dep-a', rel: 'prerequisite' }],
    });

    await addWithLinks({
      id: 'roundtrip-overwrite',
      title: 'Overwrite test',
      body: 'Updated body.',
      links: [
        { target: 'dep-b', rel: 'sequel', label: 'next step' },
        { target: 'dep-c', rel: 'part-of' },
      ],
    });

    const readResult = await client.read('roundtrip-overwrite') as Record<string, unknown>;
    const item = (readResult?.item ?? readResult) as Record<string, unknown>;
    const stored = item.links as InstructionLink[];
    expect(stored).toHaveLength(2);
    expect(stored[0].target).toBe('dep-b');
    expect(stored[1].target).toBe('dep-c');
  });

  it('TS-7: entry without links reads back without links', async () => {
    await addWithLinks({
      id: 'roundtrip-no-links',
      title: 'No links entry',
      body: 'This entry has no links.',
    });

    const readResult = await client.read('roundtrip-no-links') as Record<string, unknown>;
    const item = (readResult?.item ?? readResult) as Record<string, unknown>;
    if (item.links !== undefined) {
      expect(item.links).toHaveLength(0);
    }
  });
});

// ─── 6. Auto-split structured links (REQ-8) ─────────────────────────

describe('Auto-split: structured links', () => {
  const TMP_DIR = path.join(process.cwd(), 'tmp', 'links-autosplit');
  let bodyWarnLength: number;

  beforeAll(() => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    process.env.INDEX_SERVER_AUTO_SPLIT_OVERSIZED = '1';
    reloadRuntimeConfig();
    bodyWarnLength = getRuntimeConfig().index.bodyWarnLength;
  });

  afterAll(() => {
    delete process.env.INDEX_SERVER_AUTO_SPLIT_OVERSIZED;
  });

  beforeEach(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
  });

  it('REQ-8: split parts have structured links with sequel rel for sequential reading', async () => {
    const longBody = '## Section 1\n\n' + 'x'.repeat(bodyWarnLength) + '\n\n## Section 2\n\n' + 'y'.repeat(bodyWarnLength / 2);
    const entry = {
      id: 'split-links-test',
      title: 'Split Links Test',
      body: longBody,
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['test'],
      schemaVersion: '8',
    };

    const { splitOversizedEntry } = await import('../services/autoSplit.js');
    const parts = splitOversizedEntry(entry, bodyWarnLength);

    expect(parts.length).toBeGreaterThan(1);

    // Part 2+ should have a sequel link to the previous part
    for (let i = 1; i < parts.length; i++) {
      const links = parts[i].links as InstructionLink[];
      expect(links).toBeDefined();
      const sequelLink = links.find(l => l.rel === 'sequel');
      expect(sequelLink).toBeDefined();
      expect(sequelLink!.target).toBe(`split-links-test-part-${i}`);
    }
  });

  it('REQ-8: split parts have part-of links to siblings', async () => {
    const sections = Array.from({ length: 4 }, (_, i) =>
      `## Section ${i + 1}\n\n${'w'.repeat(Math.ceil(bodyWarnLength / 2))}`
    );
    const entry = {
      id: 'split-partof',
      title: 'Part-of Links Test',
      body: sections.join('\n\n'),
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['test'],
      schemaVersion: '8',
    };

    const { splitOversizedEntry } = await import('../services/autoSplit.js');
    const parts = splitOversizedEntry(entry, bodyWarnLength);

    expect(parts.length).toBeGreaterThan(1);

    for (const part of parts) {
      const links = part.links as InstructionLink[];
      expect(links).toBeDefined();
      expect(links.length).toBeGreaterThan(0);
      // Every part should have at least one link (sequel or part-of)
      const rels = links.map(l => l.rel);
      const hasPartOfOrSequel = rels.some(r => r === 'part-of' || r === 'sequel');
      expect(hasPartOfOrSequel).toBe(true);
    }
  });

  it('REQ-8: text footer is preserved alongside structured links', async () => {
    const longBody = '## A\n\n' + 'a'.repeat(bodyWarnLength) + '\n\n## B\n\n' + 'b'.repeat(bodyWarnLength / 2);
    const entry = {
      id: 'split-footer',
      title: 'Footer Preserved',
      body: longBody,
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['test'],
      schemaVersion: '8',
    };

    const { splitOversizedEntry } = await import('../services/autoSplit.js');
    const parts = splitOversizedEntry(entry, bodyWarnLength);

    for (const part of parts) {
      // Text footer still present
      expect(part.body).toContain('Cross-linked parts:');
      // Structured links also present
      expect(part.links).toBeDefined();
      expect((part.links as InstructionLink[]).length).toBeGreaterThan(0);
    }
  });
});

// ─── 7. Graph export link edges (REQ-13, REQ-16) ────────────────────

describe('Graph export: link edges', () => {
  let client: Awaited<ReturnType<typeof import('./helpers/mcpTestClient')['createTestClient']>>;
  const DIR = path.join(process.cwd(), 'tmp', 'links-graph-' + process.pid);

  async function addWithLinks(entry: Record<string, unknown>) {
    return client.callToolJSON('index_dispatch', {
      action: 'add',
      entry: { priority: 50, audience: 'all', requirement: 'optional', categories: [], ...entry },
      overwrite: true,
      lax: true,
    });
  }

  beforeAll(async () => {
    fs.mkdirSync(DIR, { recursive: true });
    const { createTestClient } = await import('./helpers/mcpTestClient.js');
    client = await createTestClient({ instructionsDir: DIR });

    // Create targets first so links are valid
    await addWithLinks({
      id: 'graph-c',
      title: 'Graph C',
      body: 'Entry C for graph export test.',
    });

    await addWithLinks({
      id: 'graph-b',
      title: 'Graph B',
      body: 'Entry B for graph export test.',
      links: [{ target: 'graph-c', rel: 'see-also' }],
    });

    await addWithLinks({
      id: 'graph-a',
      title: 'Graph A',
      body: 'Entry A for graph export test.',
      links: [
        { target: 'graph-b', rel: 'prerequisite', label: 'depends on' },
        { target: 'graph-c', rel: 'related' },
      ],
    });
  }, 60000);

  afterAll(async () => {
    await client?.close();
    fs.rmSync(DIR, { recursive: true, force: true });
  });

  it('REQ-16: graph export emits link edges from links arrays', async () => {
    const result = await client.callToolJSON('graph_export', { enrich: true });
    const graph = (result as any)?.data ?? result;
    const linkEdges = graph.edges.filter((e: any) => e.type === 'link');

    expect(linkEdges.length).toBeGreaterThan(0);

    // Should have forward edge graph-a -> graph-b (prerequisite)
    const aToB = linkEdges.find((e: any) => e.from === 'graph-a' && e.to === 'graph-b' && !e.inverse);
    expect(aToB).toBeDefined();
    expect(aToB.rel).toBe('prerequisite');
    expect(aToB.label).toBe('depends on');
  });

  it('REQ-13: inverse edges carry inverse: true metadata', async () => {
    const result = await client.callToolJSON('graph_export', { enrich: true });
    const graph = (result as any)?.data ?? result;
    const linkEdges = graph.edges.filter((e: any) => e.type === 'link');

    // prerequisite is reversible → should have inverse edge B -> A
    const bToA = linkEdges.find((e: any) => e.from === 'graph-b' && e.to === 'graph-a' && e.inverse === true);
    expect(bToA).toBeDefined();
    expect(bToA.rel).toBe('prerequisite');
  });

  it('REQ-13: see-also edges are directed only (no inverse)', async () => {
    const result = await client.callToolJSON('graph_export', { enrich: true });
    const graph = (result as any)?.data ?? result;
    const linkEdges = graph.edges.filter((e: any) => e.type === 'link');

    // see-also is non-reversible → B->C forward, no C->B inverse
    const bToC = linkEdges.find((e: any) => e.from === 'graph-b' && e.to === 'graph-c' && !e.inverse);
    expect(bToC).toBeDefined();
    expect(bToC.rel).toBe('see-also');

    const cToB = linkEdges.find((e: any) => e.from === 'graph-c' && e.to === 'graph-b' && e.inverse === true);
    expect(cToB).toBeUndefined();
  });

  it('REQ-13: related edges are bidirectional', async () => {
    const result = await client.callToolJSON('graph_export', { enrich: true });
    const graph = (result as any)?.data ?? result;
    const linkEdges = graph.edges.filter((e: any) => e.type === 'link');

    // related is reversible → A->C forward + C->A inverse
    const aToC = linkEdges.find((e: any) => e.from === 'graph-a' && e.to === 'graph-c' && e.rel === 'related' && !e.inverse);
    expect(aToC).toBeDefined();

    const cToA = linkEdges.find((e: any) => e.from === 'graph-c' && e.to === 'graph-a' && e.rel === 'related' && e.inverse === true);
    expect(cToA).toBeDefined();
  });
});

// ─── 8. Groom dangling link cleanup (REQ-18) ────────────────────────

describe('Groom: dangling link cleanup', () => {
  let client: Awaited<ReturnType<typeof import('./helpers/mcpTestClient')['createTestClient']>>;
  const DIR = path.join(process.cwd(), 'tmp', 'links-groom-' + process.pid);

  async function addWithLinks(entry: Record<string, unknown>) {
    return client.callToolJSON('index_dispatch', {
      action: 'add',
      entry: { priority: 50, audience: 'all', requirement: 'optional', categories: [], ...entry },
      overwrite: true,
      lax: true,
    });
  }

  beforeAll(async () => {
    fs.mkdirSync(DIR, { recursive: true });
    const { createTestClient } = await import('./helpers/mcpTestClient.js');
    client = await createTestClient({ instructionsDir: DIR });
  }, 60000);

  afterAll(async () => {
    await client?.close();
    fs.rmSync(DIR, { recursive: true, force: true });
  });

  it('REQ-18: groom removes dangling links and reports danglingLinksRemoved', async () => {
    // Create target first so the link is valid at write time
    await addWithLinks({
      id: 'groom-temp-target',
      title: 'Temporary Target',
      body: 'This will be removed to make the link dangle.',
    });

    await addWithLinks({
      id: 'groom-source',
      title: 'Groom Source',
      body: 'Entry with a link that will become dangling.',
      links: [{ target: 'groom-temp-target', rel: 'prerequisite' }],
    });

    // Remove the target to make the link dangle
    await client.callToolJSON('index_dispatch', {
      action: 'remove',
      id: 'groom-temp-target',
    });

    const groomResult = await client.callToolJSON('index_dispatch', {
      action: 'groom',
      recomputeHashes: true,
    }) as Record<string, unknown>;
    const data = (groomResult as any);

    expect(data.danglingLinksRemoved).toBeGreaterThanOrEqual(1);
    expect(data.danglingLinkDetails).toBeDefined();
    expect((data.danglingLinkDetails as unknown[]).length).toBeGreaterThanOrEqual(1);

    const detail = (data.danglingLinkDetails as Array<Record<string, unknown>>).find(
      (d) => d.id === 'groom-source' && d.target === 'groom-temp-target'
    );
    expect(detail).toBeDefined();
    expect(detail!.rel).toBe('prerequisite');
  });

  it('REQ-18: groom preserves links to existing entries', async () => {
    await addWithLinks({
      id: 'groom-valid-target',
      title: 'Valid Target',
      body: 'This target exists.',
    });

    await addWithLinks({
      id: 'groom-valid-source',
      title: 'Valid Source',
      body: 'Entry with a valid link.',
      links: [{ target: 'groom-valid-target', rel: 'related' }],
    });

    await client.callToolJSON('index_dispatch', {
      action: 'groom',
      recomputeHashes: true,
    });

    const readResult = await client.read('groom-valid-source') as Record<string, unknown>;
    const item = (readResult?.item ?? readResult) as Record<string, unknown>;
    expect(item.links).toBeDefined();
    const validLink = (item.links as InstructionLink[]).find(l => l.target === 'groom-valid-target');
    expect(validLink).toBeDefined();
  });
});

// ─── 9. SQLite migration (REQ-6) ────────────────────────────────────

describe('SQLite migration: links column', () => {
  it('REQ-6: SQLite SCHEMA_VERSION is 3', async () => {
    const { SCHEMA_VERSION: sqliteVersion } = await import('../services/storage/sqliteSchema.js');
    expect(sqliteVersion).toBe('3');
  });
});

// ─── 10. Dispatcher entryFields (W6) ────────────────────────────────

describe('Dispatcher: entryFields includes links', () => {
  it('W6: links is in the entryFields extraction list', async () => {
    // The entryFields array is not exported, but we can verify links pass through
    // the dispatcher by using the test client (which dispatches via index_dispatch)
    // and checking the round-trip. Already covered by round-trip tests above.
    // Here we do a source-level assertion.
    const dispatcherSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'services', 'instructions.dispatcher.ts'),
      'utf-8',
    );
    expect(dispatcherSource).toContain("'links'");
  });
});

// ─── 11. Edge cases (TS-12) ─────────────────────────────────────────

describe('Edge cases (TS-12): at least 5 distinct scenarios', () => {
  function makeByIdMap(...entries: Array<{ id: string; links?: InstructionLink[] }>): ReadonlyMap<string, unknown> {
    const m = new Map<string, unknown>();
    for (const e of entries) m.set(e.id, e);
    return m;
  }

  it('Edge 1: links at max (25 items) — accepted', () => {
    const entries = Array.from({ length: 26 }, (_, i) => ({ id: `e${i}` }));
    const byId = makeByIdMap(...entries);
    const links = Array.from({ length: 25 }, (_, i) => ({ target: `e${i + 1}`, rel: 'related' as const }));
    const result = validateLinks('e0', links, byId);
    expect(result.error).toBeUndefined();
    expect(result.links).toHaveLength(25);
  });

  it('Edge 2: links over max (26 items) — rejected', () => {
    const entries = Array.from({ length: 28 }, (_, i) => ({ id: `e${i}` }));
    const byId = makeByIdMap(...entries);
    const links = Array.from({ length: 26 }, (_, i) => ({ target: `e${i + 1}`, rel: 'related' as const }));
    const result = validateLinks('e0', links, byId);
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/exceeds maximum/i);
  });

  it('Edge 3: self-referencing link — rejected', () => {
    const byId = makeByIdMap({ id: 'self' });
    const result = validateLinks('self', [{ target: 'self', rel: 'related' }], byId);
    expect(result.error).toMatch(/self-referencing/i);
  });

  it('Edge 4: duplicate links (same target + rel) — deduplicated', () => {
    const byId = makeByIdMap({ id: 'src' }, { id: 'dst' });
    const result = validateLinks('src', [
      { target: 'dst', rel: 'prerequisite' },
      { target: 'dst', rel: 'prerequisite' },
    ], byId);
    expect(result.error).toBeUndefined();
    expect(result.links).toHaveLength(1);
  });

  it('Edge 5: empty links [] vs absent links — equivalent semantics', () => {
    const byId = makeByIdMap({ id: 'a' });
    const empty = validateLinks('a', [], byId);
    const absent = validateLinks('a', undefined, byId);
    expect(empty.links).toEqual(absent.links);
    expect(empty.error).toEqual(absent.error);
  });

  it('Edge 6: link to nonexistent target — warn, not reject', () => {
    const byId = makeByIdMap({ id: 'a' });
    const result = validateLinks('a', [{ target: 'missing', rel: 'see-also' }], byId);
    expect(result.error).toBeUndefined();
    expect(result.links).toHaveLength(1);
    expect(result.warnings.some(w => /dead-link/i.test(w))).toBe(true);
  });

  it('Edge 7: non-array links value — rejected', () => {
    const byId = makeByIdMap({ id: 'a' });
    const result = validateLinks('a', 'not-an-array', byId);
    expect(result.error).toMatch(/must be an array/i);
  });
});
