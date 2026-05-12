/**
 * Single-source-of-truth drift guard for buildInstructionSearchFieldsSchema().
 *
 * Issue #348: ensure every canonical record property gets a per-field predicate
 * advertised on the index_search `fields` input and every documented virtual
 * operator is present. Locks the schema surface to the canonical record schema
 * so future record fields cannot silently disappear from the search filter
 * surface (and vice versa).
 *
 * Companion to src/tests/search.spec.ts (FL-01..FL-60) which validates RUNTIME
 * filtering. This spec validates the SCHEMA SHAPE only.
 */
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  RECORD_PROPERTY_KEYS,
  buildInstructionSearchFieldsSchema,
} from '../schemas/instructionSchema';

const NUMERIC_RANGE_FIELDS = ['priority', 'usageCount', 'riskScore', 'reviewIntervalDays'] as const;
const DATE_RANGE_PREFIXES = ['created', 'updated', 'firstSeen', 'lastUsed', 'lastReviewed', 'nextReviewDue', 'archived'] as const;
const ARRAY_OPERATOR_FIELDS = ['categories', 'teamIds'] as const;
const ARRAY_OPERATORS = ['Any', 'All', 'None'] as const;

describe('buildInstructionSearchFieldsSchema — SoT drift guard (#348)', () => {
  const schema = buildInstructionSearchFieldsSchema();
  const properties = (schema as { properties: Record<string, unknown> }).properties;

  it('advertises a predicate for every canonical record property', () => {
    const missing: string[] = [];
    for (const key of RECORD_PROPERTY_KEYS) {
      if (!(key in properties)) missing.push(key);
    }
    expect(missing, 'every RECORD_PROPERTY_KEYS member must have a fields predicate').toEqual([]);
  });

  it('advertises categoriesAny/All/None and teamIdsAny/All/None operators', () => {
    for (const field of ARRAY_OPERATOR_FIELDS) {
      for (const op of ARRAY_OPERATORS) {
        const key = `${field}${op}`;
        expect(properties[key], `missing virtual operator: ${key}`).toBeDefined();
      }
    }
  });

  it('advertises idPrefix and idRegex operators', () => {
    expect(properties.idPrefix).toBeDefined();
    expect(properties.idRegex).toBeDefined();
  });

  it('advertises Min/Max pairs for every numeric range field', () => {
    for (const field of NUMERIC_RANGE_FIELDS) {
      expect(properties[`${field}Min`], `missing ${field}Min`).toBeDefined();
      expect(properties[`${field}Max`], `missing ${field}Max`).toBeDefined();
    }
  });

  it('advertises After/Before pairs for every date range field', () => {
    for (const prefix of DATE_RANGE_PREFIXES) {
      expect(properties[`${prefix}After`], `missing ${prefix}After`).toBeDefined();
      expect(properties[`${prefix}Before`], `missing ${prefix}Before`).toBeDefined();
    }
  });

  it('forbids unknown properties and requires at least one predicate', () => {
    expect((schema as { additionalProperties: unknown }).additionalProperties).toBe(false);
    expect((schema as { minProperties: unknown }).minProperties).toBe(1);
  });

  it('compiles with Ajv (no malformed sub-schemas)', () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema as object);

    // smoke validation: a minimal fields object is accepted
    expect(validate({ contentType: 'instruction' })).toBe(true);

    // empty object rejected
    expect(validate({})).toBe(false);

    // unknown predicate rejected
    expect(validate({ nonsenseFieldName: 'x' })).toBe(false);
  });
});
