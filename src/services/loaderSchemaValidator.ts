/**
 * Shared loader-schema validator — uses the SAME JSON schema the IndexLoader
 * uses at reload time, compiled once and cached at module scope.
 *
 * Every instruction write path MUST validate through this before persisting
 * to disk. This is the single source of truth that prevents schema drift
 * between write-time and load-time validation from silently dropping entries.
 */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';
import schema from '../../schemas/instruction.schema.json';
import { getRuntimeConfig } from '../config/runtimeConfig';

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
// Register draft-07 meta schema under https id (mirrors IndexLoader behavior)
try {
  const httpsIdNoHash = 'https://json-schema.org/draft-07/schema';
  const httpsIdHash = 'https://json-schema.org/draft-07/schema#';
  if (!ajv.getSchema(httpsIdNoHash)) ajv.addMetaSchema({ ...draft7MetaSchema, $id: httpsIdNoHash });
  if (!ajv.getSchema(httpsIdHash)) ajv.addMetaSchema({ ...draft7MetaSchema, $id: httpsIdHash });
} catch { /* ignore meta-schema registration issues */ }

// Patch body maxLength from config (mirrors IndexLoader behavior)
const schemaCopy = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
try {
  const bodyMaxLen = getRuntimeConfig().index?.bodyWarnLength || 50000;
  const props = (schemaCopy as { properties?: { body?: { maxLength?: number } } }).properties;
  if (props?.body) props.body.maxLength = bodyMaxLen;
} catch (err) {
  // If the bodyMaxLength patch fails the validator falls back to whatever
  // limit ships in the on-disk schema, which can mismatch the configured
  // INDEX_SERVER_BODY_WARN_LENGTH and silently accept/reject entries.
  // Surface the warning so operators can see the divergence.
  // eslint-disable-next-line no-console
  console.warn('[loaderSchemaValidator] failed to patch schema bodyMaxLength from runtime config:', (err as Error)?.message || err);
}

const validate = ajv.compile(schemaCopy);

export interface DiskValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Validate an instruction record against the loader JSON schema — the same
 * schema used by IndexLoader when loading entries from disk.
 *
 * Call this on the exact object about to be serialized with JSON.stringify()
 * and written to disk. If it fails, the entry WILL be silently skipped on
 * the next reload.
 */
export function validateForDisk(record: unknown): DiskValidationResult {
  const valid = validate(record);
  if (valid) return { valid: true };
  const errors = validate.errors?.map(e =>
    `${e.instancePath || '(root)'} ${e.message}${e.params ? ' ' + JSON.stringify(e.params) : ''}`
  ) ?? ['unknown validation error'];
  return { valid: false, errors };
}

/** Returns the set of property names allowed by the loader JSON schema. */
export function getSchemaPropertyNames(): Set<string> {
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  return props ? new Set(Object.keys(props)) : new Set();
}
