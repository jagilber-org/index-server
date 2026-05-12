// Single source of truth for the instruction record contract.
//
// The canonical JSON Schema lives at schemas/instruction.schema.json. This
// module loads it ONCE and derives every downstream artifact from it:
//
//   * RECORD_SCHEMA        — full record (used to validate on-disk entries
//                            and exports)
//   * INPUT_SCHEMA         — write-API contract: properties whose
//                            x-fieldClass is "server-managed" are stripped,
//                            additionalProperties is forced to false,
//                            required is filtered to input-only fields.
//   * RECORD_PROPERTY_KEYS — every property name on the canonical schema
//   * INPUT_KEYS           — properties accepted from callers
//   * SERVER_MANAGED_KEYS  — properties owned by the server (exports show
//                            them, input must not)
//   * REQUIRED_RECORD_KEYS — required[] from the canonical schema
//   * REQUIRED_INPUT_KEYS  — required[] minus server-managed
//   * splitEntry()         — partition a payload into
//                            { input, serverManaged, unknown }
//   * compiled validators  — validateRecord, validateInput
//
// Every other module in this codebase MUST import these derived artifacts
// instead of restating the schema. See instructionRecordValidation.ts and
// services/handlers/instructions.{add,import}.ts for the canonical
// consumers.

import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';
import canonicalSchema from '../../schemas/instruction.schema.json';

type JsonSchema = Record<string, unknown> & {
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
};

const CANONICAL = canonicalSchema as unknown as JsonSchema;

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isServerManaged(prop: JsonSchema | undefined): boolean {
  if (!prop || typeof prop !== 'object') return false;
  return (prop as Record<string, unknown>)['x-fieldClass'] === 'server-managed';
}

const allProps = (CANONICAL.properties ?? {}) as Record<string, JsonSchema>;
const requiredRecord = (CANONICAL.required ?? []) as string[];

export const RECORD_PROPERTY_KEYS: ReadonlySet<string> = new Set(Object.keys(allProps));

export const SERVER_MANAGED_KEYS: ReadonlySet<string> = new Set(
  Object.entries(allProps)
    .filter(([, def]) => isServerManaged(def))
    .map(([name]) => name),
);

export const INPUT_KEYS: ReadonlySet<string> = new Set(
  Object.keys(allProps).filter((name) => !SERVER_MANAGED_KEYS.has(name)),
);

export const REQUIRED_RECORD_KEYS: ReadonlySet<string> = new Set(requiredRecord);

export const REQUIRED_INPUT_KEYS: ReadonlySet<string> = new Set(
  requiredRecord.filter((name) => !SERVER_MANAGED_KEYS.has(name)),
);

// RECORD_SCHEMA: the canonical schema, deep-cloned so consumers cannot
// mutate the loaded module.
export const RECORD_SCHEMA: JsonSchema = deepClone(CANONICAL);

// INPUT_SCHEMA: derived. Strip server-managed properties, drop them from
// required[], force additionalProperties:false. Same $defs, same enum
// values, same patterns — single source.
export const INPUT_SCHEMA: JsonSchema = (() => {
  const cloned = deepClone(CANONICAL);
  const props = (cloned.properties ?? {}) as Record<string, JsonSchema>;
  const filteredProps: Record<string, JsonSchema> = {};
  for (const [name, def] of Object.entries(props)) {
    if (SERVER_MANAGED_KEYS.has(name)) continue;
    filteredProps[name] = def;
  }
  cloned.properties = filteredProps;
  cloned.required = ((cloned.required ?? []) as string[]).filter(
    (name) => !SERVER_MANAGED_KEYS.has(name),
  );
  cloned.additionalProperties = false;
  // Distinguish the derived schema in error messages.
  (cloned as Record<string, unknown>).$id = 'index_add#input';
  (cloned as Record<string, unknown>).title = 'InstructionInput';
  return cloned;
})();

// splitEntry: the partitioning helper used by import (and by anything else
// that needs to cleanly separate caller-supplied input from server fields,
// e.g. when persisting an export to backup or restoring from one).
export interface SplitEntryResult<T extends Record<string, unknown> = Record<string, unknown>> {
  input: Partial<T>;
  serverManaged: Partial<T>;
  unknown: Partial<T>;
}

export function splitEntry<T extends Record<string, unknown>>(entry: T | null | undefined): SplitEntryResult<T> {
  const result: SplitEntryResult<T> = { input: {}, serverManaged: {}, unknown: {} };
  if (!entry || typeof entry !== 'object') return result;
  for (const [key, value] of Object.entries(entry)) {
    if (SERVER_MANAGED_KEYS.has(key)) {
      (result.serverManaged as Record<string, unknown>)[key] = value;
    } else if (INPUT_KEYS.has(key)) {
      (result.input as Record<string, unknown>)[key] = value;
    } else {
      (result.unknown as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

// Compiled validators. Construct a single Ajv instance and register both
// schemas so error messages can reference the right $id.
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
// Register the draft-07 meta schema under both URIs Ajv may look up
// (with and without trailing '#'), since the canonical schema declares
// `$schema: "https://json-schema.org/draft-07/schema#"` and Ajv will
// validate it on compile.
for (const id of [
  'https://json-schema.org/draft-07/schema',
  'https://json-schema.org/draft-07/schema#',
  'http://json-schema.org/draft-07/schema',
  'http://json-schema.org/draft-07/schema#',
]) {
  try {
    if (!ajv.getSchema(id)) ajv.addMetaSchema(draft7MetaSchema, id);
  } catch {
    // Non-fatal: Ajv refuses to register the meta schema twice across a hot
    // module reload. Same defensive pattern used by the legacy validator.
  }
}

export const validateRecord: ValidateFunction = ajv.compile(deepClone(RECORD_SCHEMA) as object);
export const validateInput: ValidateFunction = ajv.compile(deepClone(INPUT_SCHEMA) as object);

export const INSTRUCTION_INPUT_SCHEMA_REF = 'index_add#input';
export const INSTRUCTION_RECORD_SCHEMA_REF = (CANONICAL.$id as string | undefined) ?? 'instruction.schema.json';

/**
 * Build a tool-registry-friendly variant of INPUT_SCHEMA with a caller-supplied
 * required[] minimum and a custom $id.
 *
 * Different MCP tool surfaces accept different "minimum required" shapes for
 * the SAME underlying entry contract:
 *
 *   - index_add accepts { id, body } at minimum (handler defaults the rest)
 *   - index_import requires { id, title, body, priority, audience, requirement }
 *
 * Both must still reject server-managed properties (additionalProperties:false +
 * server-managed keys stripped) and use the same property definitions, enums,
 * and patterns. This helper produces that variant from the canonical INPUT
 * schema so the tool-discovery surface advertised over MCP cannot drift from
 * the on-disk validation surface.
 */
export function buildToolInputEntrySchema(opts: { required: string[]; schemaId?: string }): JsonSchema {
  const cloned = deepClone(INPUT_SCHEMA);
  // Filter required[] to keys that actually exist as input properties. If a
  // caller asks for a server-managed key we drop it (logic error in the
  // caller, but never silently expose a server field as required input).
  cloned.required = opts.required.filter((k) => INPUT_KEYS.has(k) && !SERVER_MANAGED_KEYS.has(k));
  // Strip parent metadata that doesn't make sense embedded as a sub-schema.
  // The tool-registry overlay (withDynamicInstructionBodyLimits) injects a
  // per-compile unique $id so Ajv can both register the schema across
  // re-compiles AND resolve internal "#/definitions/..." $refs.
  const meta = cloned as Record<string, unknown>;
  delete meta.$schema;
  delete meta.title;
  if (opts.schemaId) {
    meta.$id = opts.schemaId;
  } else {
    delete meta.$id;
  }
  return cloned;
}

/**
 * Build the import entry transport schema.
 *
 * `index_import` is the backup-restore surface, so legacy records must be able
 * to reach the handler-side schema migration layer before strict canonical
 * validation runs. The property set still derives from INPUT_SCHEMA and still
 * rejects unknown/server-managed fields, but selected legacy-migrated fields are
 * widened to their transport type so old enum/id/priority drift can be repaired.
 */
export function buildToolImportEntrySchema(opts: { schemaId?: string } = {}): JsonSchema {
  const cloned = buildToolInputEntrySchema({ required: ['id', 'title', 'body'], schemaId: opts.schemaId });
  const props = cloned.properties ?? {};
  props.id = { type: 'string', minLength: 1 };
  props.priority = { type: 'number' };
  props.audience = { type: 'string' };
  props.requirement = { type: 'string' };
  props.contentType = { type: 'string' };
  return cloned;
}

function oneOrManySchema(schema: JsonSchema): JsonSchema {
  return {
    oneOf: [
      deepClone(schema),
      { type: 'array', minItems: 1, items: deepClone(schema) },
    ],
  };
}

function searchFieldPropertySchema(schema: JsonSchema): JsonSchema {
  if (schema.type === 'array' && schema.items) {
    const itemSchema = (schema.items as JsonSchema).$ref
      ? { type: 'object', additionalProperties: true }
      : schema.items as JsonSchema;
    return oneOrManySchema(itemSchema);
  }
  if (schema.type === 'object') {
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object' && (schema.additionalProperties as JsonSchema).$ref) {
      return { type: 'object', additionalProperties: true };
    }
    return deepClone(schema);
  }
  return oneOrManySchema(schema);
}

/**
 * Build the schema for index_search.fields from the canonical record schema.
 *
 * Top-level instruction fields accept exact values, with arrays meaning OR for
 * scalar values and contains-any for array fields. Virtual operators are added
 * explicitly and unknown keys are rejected.
 */
export function buildInstructionSearchFieldsSchema(): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const [name, schema] of Object.entries((RECORD_SCHEMA.properties ?? {}) as Record<string, JsonSchema>)) {
    properties[name] = searchFieldPropertySchema(schema);
  }
  const stringArray: JsonSchema = { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } };
  const dateString: JsonSchema = { type: 'string', minLength: 1, format: 'date-time' };
  Object.assign(properties, {
    categoriesAny: deepClone(stringArray),
    categoriesAll: deepClone(stringArray),
    categoriesNone: deepClone(stringArray),
    teamIdsAny: deepClone(stringArray),
    teamIdsAll: deepClone(stringArray),
    teamIdsNone: deepClone(stringArray),
    idPrefix: { type: 'string', minLength: 1, maxLength: 120 },
    idRegex: { type: 'string', minLength: 1, maxLength: 200 },
  });
  for (const field of ['priority', 'usageCount', 'riskScore', 'reviewIntervalDays']) {
    properties[`${field}Min`] = { type: 'number' };
    properties[`${field}Max`] = { type: 'number' };
  }
  for (const field of ['created', 'updated', 'firstSeen', 'lastUsed', 'lastReviewed', 'nextReviewDue', 'archived']) {
    properties[`${field}After`] = deepClone(dateString);
    properties[`${field}Before`] = deepClone(dateString);
  }
  return {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties,
  };
}
