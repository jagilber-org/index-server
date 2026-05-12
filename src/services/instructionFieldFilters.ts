import { InstructionEntry } from '../models/instruction';
import { RECORD_PROPERTY_KEYS, RECORD_SCHEMA } from '../schemas/instructionSchema';
import { compileSafeUserRegex } from './searchRegex';

export type InstructionSearchFields = Record<string, unknown>;

export interface CompiledInstructionFieldFilter {
  predicate: (entry: InstructionEntry) => boolean;
  applied: InstructionSearchFields;
  matchedFieldNames: string[];
}

type JsonSchema = Record<string, unknown> & {
  type?: string;
  enum?: unknown[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  $ref?: string;
};

const ARRAY_OPERATORS = ['Any', 'All', 'None'] as const;
const ARRAY_OPERATOR_FIELDS = ['categories', 'teamIds'] as const;
const NUMERIC_RANGE_FIELDS = ['priority', 'usageCount', 'riskScore', 'reviewIntervalDays'] as const;
const DATE_RANGE_FIELDS: Record<string, keyof InstructionEntry> = {
  created: 'createdAt',
  updated: 'updatedAt',
  firstSeen: 'firstSeenTs',
  lastUsed: 'lastUsedAt',
  lastReviewed: 'lastReviewedAt',
  nextReviewDue: 'nextReviewDue',
  archived: 'archivedAt',
};

const VIRTUAL_KEYS = new Set<string>([
  ...ARRAY_OPERATOR_FIELDS.flatMap(field => ARRAY_OPERATORS.map(op => `${field}${op}`)),
  'idPrefix',
  'idRegex',
  ...NUMERIC_RANGE_FIELDS.flatMap(field => [`${field}Min`, `${field}Max`]),
  ...Object.keys(DATE_RANGE_FIELDS).flatMap(field => [`${field}After`, `${field}Before`]),
]);

const RECORD_PROPERTIES = (RECORD_SCHEMA.properties ?? {}) as Record<string, JsonSchema>;

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeString(value: string, caseSensitive: boolean): string {
  const trimmed = value.trim();
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

function valuesAsArray(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) {
    if (value.length === 0) throw new Error(`fields.${key} must not be an empty array`);
    return value;
  }
  return [value];
}

function schemaType(schema: JsonSchema | undefined): string | undefined {
  if (!schema) return undefined;
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.enum)) return 'string';
  return undefined;
}

function validateEnumValue(key: string, schema: JsonSchema, value: unknown): void {
  if (!Array.isArray(schema.enum)) return;
  if (typeof value !== 'string' || !schema.enum.includes(value)) {
    throw new Error(`fields.${key} must be one of: ${schema.enum.join(', ')}`);
  }
}

function validateBySchemaType(key: string, schema: JsonSchema, value: unknown): void {
  validateEnumValue(key, schema, value);
  if (Array.isArray(schema.enum)) return;

  const type = schemaType(schema);
  if (type === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`fields.${key} must be an integer`);
  } else if (type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) throw new Error(`fields.${key} must be a number`);
  } else if (type === 'string') {
    if (typeof value !== 'string') throw new Error(`fields.${key} must be a string`);
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`fields.${key} must be a boolean`);
  } else if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`fields.${key} must be an object`);
  }
}

function validateCanonicalField(key: string, expected: unknown): void {
  const schema = RECORD_PROPERTIES[key];
  const type = schemaType(schema);
  if (type === 'array') {
    const itemSchema = schema.items ?? {};
    for (const item of valuesAsArray(expected, key)) validateBySchemaType(key, itemSchema, item);
    return;
  }
  if (type === 'object') {
    validateBySchemaType(key, schema, expected);
    return;
  }
  for (const item of valuesAsArray(expected, key)) validateBySchemaType(key, schema, item);
}

function validateStringArrayOperator(key: string, value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || item.trim().length === 0)) {
    throw new Error(`fields.${key} must be a non-empty string array`);
  }
  return value;
}

function parseDateFilter(key: string, value: unknown): number {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`fields.${key} must be an ISO date string`);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`fields.${key} must be a valid ISO date string`);
  return parsed;
}

function matchesScalar(actual: unknown, expected: unknown, caseSensitive: boolean): boolean {
  if (actual === undefined || actual === null) return false;
  if (typeof actual === 'string' && typeof expected === 'string') {
    return normalizeString(actual, caseSensitive) === normalizeString(expected, caseSensitive);
  }
  if (typeof actual === 'number' || typeof actual === 'boolean') return actual === expected;
  return deepEqual(actual, expected);
}

function matchesCanonicalField(entry: InstructionEntry, key: string, expected: unknown, caseSensitive: boolean): boolean {
  const actual = (entry as unknown as Record<string, unknown>)[key];
  const schema = RECORD_PROPERTIES[key];
  if (schemaType(schema) === 'array') {
    if (!Array.isArray(actual)) return false;
    return valuesAsArray(expected, key).some(expectedItem =>
      actual.some(actualItem => matchesScalar(actualItem, expectedItem, caseSensitive)),
    );
  }
  if (schemaType(schema) === 'object') {
    return matchesScalar(actual, expected, caseSensitive);
  }
  return valuesAsArray(expected, key).some(expectedItem => matchesScalar(actual, expectedItem, caseSensitive));
}

function getStringArrayField(entry: InstructionEntry, key: string): string[] {
  const value = (entry as unknown as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function compareStringArrayField(entry: InstructionEntry, key: string, expected: string[], op: typeof ARRAY_OPERATORS[number], caseSensitive: boolean): boolean {
  const actual = getStringArrayField(entry, key).map(item => normalizeString(item, caseSensitive));
  const wanted = expected.map(item => normalizeString(item, caseSensitive));
  if (op === 'Any') return wanted.some(item => actual.includes(item));
  if (op === 'All') return wanted.every(item => actual.includes(item));
  return wanted.every(item => !actual.includes(item));
}

function compareRange(value: unknown, min?: number, max?: number): boolean {
  if (typeof value !== 'number' || Number.isNaN(value)) return false;
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

function compareDateRange(value: unknown, after?: number, before?: number): boolean {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  if (after !== undefined && parsed < after) return false;
  if (before !== undefined && parsed > before) return false;
  return true;
}

export function compileInstructionFieldFilter(
  fields: InstructionSearchFields | undefined,
  options: { caseSensitive: boolean },
): CompiledInstructionFieldFilter | undefined {
  if (fields === undefined) return undefined;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new Error('fields must be an object');
  }
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (entries.length === 0) throw new Error('fields must contain at least one predicate');

  for (const [key, value] of entries) {
    if (!RECORD_PROPERTY_KEYS.has(key) && !VIRTUAL_KEYS.has(key)) {
      throw new Error(`Unknown fields predicate: ${key}`);
    }
    if (RECORD_PROPERTY_KEYS.has(key)) validateCanonicalField(key, value);
  }

  const idPrefix = fields.idPrefix;
  if (idPrefix !== undefined && (typeof idPrefix !== 'string' || idPrefix.trim().length === 0)) {
    throw new Error('fields.idPrefix must be a non-empty string');
  }
  const idRegex = fields.idRegex;
  if (idRegex !== undefined && typeof idRegex !== 'string') {
    throw new Error('fields.idRegex must be a string');
  }
  const compiledIdRegex = idRegex === undefined
    ? undefined
    : compileSafeUserRegex(idRegex, options.caseSensitive ? '' : 'i');

  const numericRanges = new Map<string, { min?: number; max?: number }>();
  for (const field of NUMERIC_RANGE_FIELDS) {
    const minKey = `${field}Min`;
    const maxKey = `${field}Max`;
    const min = fields[minKey];
    const max = fields[maxKey];
    if (min !== undefined && typeof min !== 'number') throw new Error(`fields.${minKey} must be a number`);
    if (max !== undefined && typeof max !== 'number') throw new Error(`fields.${maxKey} must be a number`);
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      throw new Error(`fields.${field}Min must be less than or equal to fields.${field}Max`);
    }
    if (typeof min === 'number' || typeof max === 'number') numericRanges.set(field, { min, max });
  }

  const dateRanges = new Map<keyof InstructionEntry, { after?: number; before?: number }>();
  for (const [prefix, field] of Object.entries(DATE_RANGE_FIELDS)) {
    const afterKey = `${prefix}After`;
    const beforeKey = `${prefix}Before`;
    const after = fields[afterKey] === undefined ? undefined : parseDateFilter(afterKey, fields[afterKey]);
    const before = fields[beforeKey] === undefined ? undefined : parseDateFilter(beforeKey, fields[beforeKey]);
    if (after !== undefined && before !== undefined && after > before) {
      throw new Error(`fields.${afterKey} must be before or equal to fields.${beforeKey}`);
    }
    if (after !== undefined || before !== undefined) dateRanges.set(field, { after, before });
  }

  const arrayOps: Array<{ field: string; op: typeof ARRAY_OPERATORS[number]; values: string[]; key: string }> = [];
  for (const field of ARRAY_OPERATOR_FIELDS) {
    for (const op of ARRAY_OPERATORS) {
      const key = `${field}${op}`;
      const value = fields[key];
      if (value !== undefined) arrayOps.push({ field, op, values: validateStringArrayOperator(key, value), key });
    }
  }

  const canonicalEntries = entries.filter(([key]) => RECORD_PROPERTY_KEYS.has(key));
  const normalizedPrefix = typeof idPrefix === 'string' ? normalizeString(idPrefix, options.caseSensitive) : undefined;

  return {
    applied: { ...fields },
    matchedFieldNames: entries.map(([key]) => key),
    predicate: (entry: InstructionEntry): boolean => {
      for (const [key, expected] of canonicalEntries) {
        if (!matchesCanonicalField(entry, key, expected, options.caseSensitive)) return false;
      }
      for (const { field, op, values } of arrayOps) {
        if (!compareStringArrayField(entry, field, values, op, options.caseSensitive)) return false;
      }
      if (normalizedPrefix !== undefined && !normalizeString(entry.id, options.caseSensitive).startsWith(normalizedPrefix)) {
        return false;
      }
      if (compiledIdRegex) {
        compiledIdRegex.lastIndex = 0;
        if (!compiledIdRegex.test(entry.id)) return false;
      }
      for (const [field, range] of numericRanges) {
        if (!compareRange((entry as unknown as Record<string, unknown>)[field], range.min, range.max)) return false;
      }
      for (const [field, range] of dateRanges) {
        if (!compareDateRange((entry as unknown as Record<string, unknown>)[field], range.after, range.before)) return false;
      }
      return true;
    },
  };
}

export function applyInstructionFieldFilter(
  entries: InstructionEntry[],
  filter: CompiledInstructionFieldFilter | undefined,
): InstructionEntry[] {
  return filter ? entries.filter(filter.predicate) : entries;
}
