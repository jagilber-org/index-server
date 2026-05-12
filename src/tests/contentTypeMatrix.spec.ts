/**
 * Every-enum × every-value matrix test.
 *
 * For each canonical schema enum (contentType, audience, requirement, status,
 * priorityTier, classification) × each value in that enum, this test drives
 * the value through every consumer surface that validates / advertises it:
 *
 *   1. JSON schema enum (canonical)
 *   2. src/models/instruction.ts TS literal tuple
 *   3. validateInstructionInputEnumMembership (input validator)
 *   4. validateParams('index_add', ...) (Zod registry path)
 *   5. tool registry inputSchema for index_add entry.<field> (advertised enum)
 *   6. migrateInstructionRecord (persisted record migration preserves valid values)
 *
 * Any future value added to the JSON schema is automatically exercised by
 * every assertion below. Any value removed is automatically dropped.
 *
 * Do NOT replace the CANONICAL_* constants with hand-typed arrays —
 * they must come from the JSON schema so this test cannot drift.
 *
 * NOTE: contentType also has a legacy removed-values cohort
 * (reference, example, chat-session) asserted explicitly to be rejected by
 * the input validator and Zod path.
 */

import { describe, expect, it } from 'vitest';
import canonicalSchema from '../../schemas/instruction.schema.json';
import {
  CONTENT_TYPES,
  AUDIENCES,
  REQUIREMENTS,
  STATUSES,
  PRIORITY_TIERS,
  CLASSIFICATIONS,
} from '../models/instruction';
import { validateInstructionInputEnumMembership } from '../services/instructionRecordValidation';
import { migrateInstructionRecord } from '../versioning/schemaVersion';
import { getToolRegistry } from '../services/toolRegistry';
import { getZodEnhancedRegistry } from '../services/toolRegistry.zod';
import { validateParams } from '../services/validationService';

type SchemaProps = { properties: Record<string, { enum?: unknown }> };
function canonicalEnum(field: string): readonly string[] {
  const e = (canonicalSchema as unknown as SchemaProps).properties[field]?.enum;
  if (!Array.isArray(e)) throw new Error(`canonical schema lacks enum for ${field}`);
  return e as string[];
}

const CANONICAL_CONTENT_TYPES = canonicalEnum('contentType');
const REMOVED_CONTENT_TYPES = ['reference', 'example', 'chat-session'] as const;

// Single table-of-truth for the every-enum matrix. Adding a new schema enum
// is a one-line change: append a row here and add a const tuple to
// src/models/instruction.ts ENUM_GUARDS — both will be exercised by every
// matrix assertion.
const ENUM_MATRIX: ReadonlyArray<{
  field: 'contentType' | 'audience' | 'requirement' | 'status' | 'priorityTier' | 'classification';
  tuple: readonly string[];
  // A bogus value guaranteed to be neither canonical nor accepted by
  // applyWriteCompatibility coercions, used for reject-path assertions.
  rejectValue: string;
}> = [
  { field: 'contentType', tuple: CONTENT_TYPES, rejectValue: '__not-a-real-contenttype__' },
  { field: 'audience', tuple: AUDIENCES, rejectValue: '__not-a-real-audience__' },
  { field: 'requirement', tuple: REQUIREMENTS, rejectValue: '__not-a-real-requirement__' },
  { field: 'status', tuple: STATUSES, rejectValue: '__not-a-real-status__' },
  { field: 'priorityTier', tuple: PRIORITY_TIERS, rejectValue: '__not-a-real-tier__' },
  { field: 'classification', tuple: CLASSIFICATIONS, rejectValue: '__not-a-real-classification__' },
];

// Initialize registries once so .find() / validateParams work.
// Use 'admin' tier so extended/mutation tools (e.g. index_add) are included —
// the matrix must cover every surface, not just the core tier.
getZodEnhancedRegistry();
const registry = getToolRegistry({ tier: 'admin' });

function getIndexAddEntryEnum(field: string): string[] {
  const tool = registry.find(t => t.name === 'index_add');
  if (!tool) throw new Error('index_add not registered');
  const entryProps = (tool.inputSchema as {
    properties: { entry: { properties: Record<string, { enum?: string[] }> } };
  }).properties.entry.properties;
  const fieldSchema = entryProps[field];
  if (!Array.isArray(fieldSchema?.enum)) {
    throw new Error(`index_add entry.${field} has no enum`);
  }
  return fieldSchema!.enum!;
}

function baseValidEntry(): Record<string, unknown> {
  return {
    title: 'm',
    body: 'b',
    priority: 50,
    audience: 'all',
    requirement: 'optional',
    categories: ['matrix'],
    contentType: 'instruction',
  };
}

describe('every-enum × every-value matrix — JSON↔TS parity', () => {
  it.each(ENUM_MATRIX.map(r => [r.field, r.tuple] as const))(
    'enum "%s": canonical JSON enum matches TS tuple exactly',
    (field, tuple) => {
      const canonical = canonicalEnum(field);
      expect(canonical.length).toBeGreaterThan(0);
      expect([...tuple]).toEqual([...canonical]);
    },
  );
});

describe('every-enum × every-value matrix — accept canonical values', () => {
  // Flatten all (field, value) pairs into one table for it.each.
  const acceptCases: Array<[string, string]> = [];
  for (const { field, tuple } of ENUM_MATRIX) {
    for (const v of tuple) acceptCases.push([field, v]);
  }

  it.each(acceptCases)(
    'input validator accepts %s="%s"',
    (field, value) => {
      const entry = { ...baseValidEntry(), id: `matrix-${field}-${value}`, [field]: value };
      const errs = validateInstructionInputEnumMembership(entry);
      expect(errs, `unexpected errors: ${JSON.stringify(errs)}`).toEqual([]);
    },
  );

  it.each(acceptCases)(
    'index_add Zod validation accepts %s="%s"',
    (field, value) => {
      const result = validateParams('index_add', {
        entry: {
          id: `matrix-zod-${field}-${value}`,
          title: `Matrix ${field}=${value}`,
          body: `Body for ${field}=${value}`,
          [field]: value,
        },
        lax: true,
        overwrite: true,
      });
      expect(
        result.ok,
        `index_add rejected ${field}="${value}": ${JSON.stringify((result as unknown as { errors?: unknown }).errors)}`,
      ).toBe(true);
    },
  );

  it.each(acceptCases)(
    'migrateInstructionRecord preserves canonical %s="%s"',
    (field, value) => {
      const rec: Record<string, unknown> = {
        ...baseValidEntry(),
        id: `matrix-mig-${field}-${value}`,
        [field]: value,
        schemaVersion: '3',
      };
      migrateInstructionRecord(rec);
      expect(rec[field]).toBe(value);
    },
  );
});

describe('every-enum × every-value matrix — registry advertises canonical enum', () => {
  it.each(ENUM_MATRIX.map(r => [r.field] as const))(
    'index_add entry.%s inputSchema advertises exactly the canonical enum',
    (field) => {
      const advertised = getIndexAddEntryEnum(field);
      expect(advertised).toEqual([...canonicalEnum(field)]);
    },
  );
});

describe('every-enum × every-value matrix — reject non-canonical values', () => {
  it.each(ENUM_MATRIX.map(r => [r.field, r.rejectValue] as const))(
    'input validator rejects %s="%s"',
    (field, badValue) => {
      const entry = { ...baseValidEntry(), id: `rm-${field}`, [field]: badValue };
      const errs = validateInstructionInputEnumMembership(entry);
      expect(errs.some(e => e.startsWith(`/${field}:`))).toBe(true);
    },
  );

  it.each(ENUM_MATRIX.map(r => [r.field, r.rejectValue] as const))(
    'index_add Zod validation rejects %s="%s"',
    (field, badValue) => {
      const result = validateParams('index_add', {
        entry: {
          id: `rm-zod-${field}`,
          title: `Bad ${field}`,
          body: `Body bad ${field}`,
          [field]: badValue,
        },
        lax: true,
        overwrite: true,
      });
      expect(result.ok).toBe(false);
    },
  );
});

// Legacy/removed contentType cohort — preserved from the original
// contentType-focused matrix. These values were once valid contentTypes and
// removed; every surface must reject them.
describe('contentType legacy removed-values cohort', () => {
  it.each(REMOVED_CONTENT_TYPES.map(c => [c]))(
    'removed contentType "%s" is rejected by input validator',
    (contentType) => {
      const errs = validateInstructionInputEnumMembership({
        ...baseValidEntry(),
        id: `rm-${contentType}`,
        contentType,
      });
      expect(errs.some(e => e.startsWith('/contentType:'))).toBe(true);
    },
  );

  it.each(REMOVED_CONTENT_TYPES.map(c => [c]))(
    'removed contentType "%s" is rejected by index_add Zod validation',
    (contentType) => {
      const result = validateParams('index_add', {
        entry: {
          id: `rm-zod-${contentType}`,
          title: `Removed ${contentType}`,
          body: `Body for ${contentType}`,
          contentType,
        },
        lax: true,
        overwrite: true,
      });
      expect(result.ok).toBe(false);
    },
  );

  it.each(REMOVED_CONTENT_TYPES.map(c => [c]))(
    'removed contentType "%s" is NOT silently rewritten by migration',
    (contentType) => {
      const rec: Record<string, unknown> = {
        ...baseValidEntry(),
        id: `rm-mig-${contentType}`,
        contentType,
        schemaVersion: '4',
      };
      migrateInstructionRecord(rec);
      expect(rec.contentType).toBe(contentType);
    },
  );

  it('removed values are absent from canonical enum', () => {
    for (const rm of REMOVED_CONTENT_TYPES) {
      expect(CANONICAL_CONTENT_TYPES).not.toContain(rm);
    }
  });
});

// Assertion: the governanceUpdate `status` enum (which intentionally omits
// 'review' per PROJECT_PRD Governance Hash Integrity Policy) is a strict
// subset of the canonical STATUSES. If a future schema change removes one of
// the governanceUpdate-allowed statuses, this assertion fails loudly.
describe('governanceUpdate status subset is a strict subset of STATUSES', () => {
  it('every governanceUpdate-allowed status is a member of STATUSES', () => {
    const tool = registry.find(t => t.name === 'index_governanceUpdate');
    if (!tool) throw new Error('index_governanceUpdate not registered');
    const advertised = (tool.inputSchema as {
      properties: { status: { enum: string[] } };
    }).properties.status.enum;
    expect(Array.isArray(advertised)).toBe(true);
    expect(advertised.length).toBeGreaterThan(0);
    expect(advertised.length).toBeLessThan(STATUSES.length);
    for (const s of advertised) {
      expect(STATUSES).toContain(s as typeof STATUSES[number]);
    }
  });
});
