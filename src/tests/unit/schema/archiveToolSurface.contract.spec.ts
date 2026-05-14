/**
 * Archive tool-surface AJV contract sweep (Phase G1 / G3).
 *
 * Spec 006-archive-lifecycle, REQ-21 / REQ-22, plus REQ-10 (dispatcher
 * filter contract) and REQ-18 (index_remove mode parameter).
 *
 * Goal: prove every MCP tool surface that mentions archive metadata
 * accepts and rejects payloads exactly as INPUT_SCHEMAS declares. The
 * earlier `archiveTools.contract.spec.ts` asserts schema *shape*
 * (registry presence, STABLE/MUTATION classification). This sweep is the
 * AJV-driven complement that asserts schema *behaviour* — what payloads
 * pass and what payloads fail validation.
 *
 * Tools covered:
 *   - index_archive
 *   - index_restore
 *   - index_listArchived
 *   - index_getArchived
 *   - index_purgeArchive
 *   - index_remove (mode parameter only)
 *   - index_groom (mode.purgeArchive parameter only)
 *   - index_dispatch (includeArchived / onlyArchived mutex; archive
 *     lifecycle action enum members)
 */

import { describe, it, expect } from 'vitest';
import Ajv, { type ValidateFunction } from 'ajv';
import { getToolRegistry } from '../../../services/toolRegistry.js';
import { ARCHIVE_REASONS, ARCHIVE_SOURCES } from '../../../models/instruction.js';
import '../../../services/toolHandlers.js';

const ajv = new Ajv({ strict: false, allErrors: true });

interface RegEntry {
  name: string;
  inputSchema: Record<string, unknown>;
}

function loadRegistry(): Map<string, RegEntry> {
  const m = new Map<string, RegEntry>();
  for (const e of getToolRegistry({ tier: 'admin' })) {
    m.set(e.name, e as RegEntry);
  }
  return m;
}

function compile(schema: Record<string, unknown>): ValidateFunction {
  return ajv.compile(schema);
}

const REG = loadRegistry();

function schemaFor(name: string): Record<string, unknown> {
  const e = REG.get(name);
  if (!e) throw new Error(`tool ${name} not in registry`);
  return e.inputSchema;
}

// ── index_archive ────────────────────────────────────────────────────────────

describe('index_archive — AJV contract', () => {
  const validate = compile(schemaFor('index_archive'));

  it('accepts a minimal payload { ids: ["x"] }', () => {
    expect(validate({ ids: ['x'] })).toBe(true);
  });

  it.each(ARCHIVE_REASONS.map(r => [r] as const))('accepts each ArchiveReason: %s', (reason) => {
    expect(validate({ ids: ['x'], reason })).toBe(true);
  });

  it('rejects an unknown archive reason', () => {
    expect(validate({ ids: ['x'], reason: 'totally-bogus' })).toBe(false);
  });

  it('rejects missing ids', () => {
    expect(validate({ reason: 'manual' })).toBe(false);
  });

  it('rejects empty ids array (minItems: 1)', () => {
    expect(validate({ ids: [] })).toBe(false);
  });

  it('rejects unknown top-level fields (additionalProperties: false)', () => {
    expect(validate({ ids: ['x'], surpriseField: 1 })).toBe(false);
  });

  it('accepts optional archivedBy + dryRun', () => {
    expect(validate({ ids: ['x'], reason: 'manual', archivedBy: 'tester', dryRun: true })).toBe(true);
  });
});

// ── index_restore ────────────────────────────────────────────────────────────

describe('index_restore — AJV contract', () => {
  const validate = compile(schemaFor('index_restore'));

  it('accepts a minimal payload { ids: ["x"] }', () => {
    expect(validate({ ids: ['x'] })).toBe(true);
  });

  it.each([['reject'], ['overwrite']])('accepts restoreMode: %s', (mode) => {
    expect(validate({ ids: ['x'], restoreMode: mode })).toBe(true);
  });

  it('rejects unknown restoreMode', () => {
    expect(validate({ ids: ['x'], restoreMode: 'merge' })).toBe(false);
  });

  it('rejects missing ids', () => {
    expect(validate({ restoreMode: 'reject' })).toBe(false);
  });

  it('schema declares default restoreMode of "reject"', () => {
    const s = schemaFor('index_restore') as { properties?: Record<string, { default?: unknown }> };
    expect(s.properties?.restoreMode?.default).toBe('reject');
  });
});

// ── index_listArchived ───────────────────────────────────────────────────────

describe('index_listArchived — AJV contract', () => {
  const validate = compile(schemaFor('index_listArchived'));

  it('accepts an empty payload', () => {
    expect(validate({})).toBe(true);
  });

  it('accepts all documented filters', () => {
    expect(validate({
      category: 'general',
      contentType: 'instruction',
      reason: 'manual',
      source: 'archive',
      archivedBy: 'a',
      restoreEligible: true,
      includeContent: false,
      limit: 50,
      offset: 0,
    })).toBe(true);
  });

  it.each(ARCHIVE_REASONS.map(r => [r] as const))('reason filter accepts %s', (r) => {
    expect(validate({ reason: r })).toBe(true);
  });

  it.each(ARCHIVE_SOURCES.map(s => [s] as const))('source filter accepts %s', (s) => {
    expect(validate({ source: s })).toBe(true);
  });

  it('rejects out-of-enum reason', () => {
    expect(validate({ reason: 'made-up' })).toBe(false);
  });

  it('rejects out-of-enum source', () => {
    expect(validate({ source: 'made-up-pathway' })).toBe(false);
  });

  it('rejects unknown top-level fields (additionalProperties: false)', () => {
    expect(validate({ surpriseField: true })).toBe(false);
  });

  it('rejects limit < 1', () => {
    expect(validate({ limit: 0 })).toBe(false);
  });
});

// ── index_getArchived ────────────────────────────────────────────────────────

describe('index_getArchived — AJV contract', () => {
  const validate = compile(schemaFor('index_getArchived'));

  it('accepts { id: "x" }', () => {
    expect(validate({ id: 'x' })).toBe(true);
  });

  it('rejects missing id', () => {
    expect(validate({})).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(validate({ id: 'x', extra: 1 })).toBe(false);
  });
});

// ── index_purgeArchive ───────────────────────────────────────────────────────

describe('index_purgeArchive — AJV contract', () => {
  const validate = compile(schemaFor('index_purgeArchive'));

  it('accepts a minimal payload { ids: ["x"] }', () => {
    expect(validate({ ids: ['x'] })).toBe(true);
  });

  it('accepts force + dryRun', () => {
    expect(validate({ ids: ['x'], force: true, dryRun: true })).toBe(true);
  });

  it('rejects missing ids', () => {
    expect(validate({ force: true })).toBe(false);
  });

  it('rejects empty ids array', () => {
    expect(validate({ ids: [] })).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(validate({ ids: ['x'], yolo: true })).toBe(false);
  });
});

// ── index_remove (mode parameter only) ────────────────────────────────────────

describe('index_remove — mode parameter AJV contract', () => {
  const validate = compile(schemaFor('index_remove'));

  it.each([['archive'], ['purge']])('accepts mode=%s', (mode) => {
    expect(validate({ ids: ['x'], mode })).toBe(true);
  });

  it('accepts payload with mode omitted (transition behaviour, REQ-19)', () => {
    expect(validate({ ids: ['x'] })).toBe(true);
  });

  it('rejects unknown mode value', () => {
    expect(validate({ ids: ['x'], mode: 'delete' })).toBe(false);
  });

  it('accepts purge:true alias', () => {
    expect(validate({ ids: ['x'], purge: true })).toBe(true);
  });
});

// ── index_groom (mode.purgeArchive parameter only) ──────────────────────────

describe('index_groom — mode.purgeArchive AJV contract', () => {
  const validate = compile(schemaFor('index_groom'));

  it('accepts mode.purgeArchive: true', () => {
    expect(validate({ mode: { purgeArchive: true } })).toBe(true);
  });

  it('accepts mode.purgeArchive combined with ids subset', () => {
    expect(validate({ mode: { purgeArchive: true }, ids: ['x', 'y'] })).toBe(true);
  });

  it('rejects unknown mode keys (additionalProperties: false on mode)', () => {
    expect(validate({ mode: { surpriseFlag: true } })).toBe(false);
  });
});

// ── index_dispatch (archive surface) ─────────────────────────────────────────

describe('index_dispatch — archive surface AJV contract', () => {
  const validate = compile(schemaFor('index_dispatch'));

  it.each([['archive'], ['restore'], ['listArchived'], ['getArchived'], ['purgeArchive']])(
    'accepts action: %s',
    (action) => {
      expect(validate({ action })).toBe(true);
    },
  );

  it('accepts includeArchived alone', () => {
    expect(validate({ action: 'list', includeArchived: true })).toBe(true);
  });

  it('accepts onlyArchived alone', () => {
    expect(validate({ action: 'list', onlyArchived: true })).toBe(true);
  });

  it('rejects includeArchived + onlyArchived together (mutually exclusive)', () => {
    expect(validate({ action: 'list', includeArchived: true, onlyArchived: true })).toBe(false);
  });

  it('rejects unknown action', () => {
    expect(validate({ action: 'totally-bogus-action' })).toBe(false);
  });

  it('rejects missing action', () => {
    expect(validate({})).toBe(false);
  });
});
