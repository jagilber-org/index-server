import Ajv, { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { getZodEnhancedRegistry } from './toolRegistry.zod';
import { ZodError, ZodTypeAny } from 'zod';

interface ValidatorEntry { validate: (data: unknown)=>boolean; errors: ErrorObject[] | null | undefined }
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
try {
  if(!ajv.getSchema('https://json-schema.org/draft-07/schema')) ajv.addMetaSchema(draft7MetaSchema, 'https://json-schema.org/draft-07/schema');
} catch (e) {
  // ignore meta-schema registration errors (non-fatal)
}
const cache = new Map<string, ValidatorEntry | null>();

// Validation mode feature flag is centrally defined via runtime config.
// Modes: 'ajv' => force Ajv only, 'zod' (default) => prefer Zod with Ajv fallback, 'auto' reserved for future heuristics.
function resolveValidationMode(): string {
  const mode = getRuntimeConfig().validation.mode;
  return mode && mode.trim().length ? mode : 'zod';
}

// Simple counters for metrics_snapshot (zod vs ajv path usage)
interface ValidationCounters { zodSuccess: number; zodFailure: number; ajvSuccess: number; ajvFailure: number; mode: string }
const validationCounters: ValidationCounters = { zodSuccess: 0, zodFailure: 0, ajvSuccess: 0, ajvFailure: 0, mode: resolveValidationMode() };

function resolveValidationSettings(){
  const mode = resolveValidationMode();
  validationCounters.mode = mode;
  return { mode, forceAjv: mode === 'ajv' };
}
declare global { // augment global type for side-channel metrics exposure
  // eslint-disable-next-line no-var
  var __MCP_VALIDATION_METRICS__ : ValidationCounters | undefined;
}
globalThis.__MCP_VALIDATION_METRICS__ = validationCounters;

// Composite validator prefers Zod (when present) then falls back to Ajv JSON Schema.
interface AjvLikeValidateFn {
  (data: unknown): boolean;
  errors?: ErrorObject[];
}
interface CompositeValidator extends ValidatorEntry { zod?: ZodTypeAny; ajvFn?: AjvLikeValidateFn }

function buildValidator(method: string): ValidatorEntry | null {
  try {
    const reg = getZodEnhancedRegistry().find(t => t.name === method);
    if(!reg) return null;
    const compiled = ajv.compile(reg.inputSchema as object) as AjvLikeValidateFn;
    const { forceAjv } = resolveValidationSettings();
    if(reg.zodSchema && !forceAjv){
      const z = reg.zodSchema as ZodTypeAny;
      const v: CompositeValidator = {
        validate: (d: unknown) => {
          try { z.parse(d ?? {}); return true; } catch(e){
            if(e instanceof ZodError){
              // Map Zod issues into Ajv-like errors for uniform consumption
              compiled.errors = e.issues.map(issue => ({
                instancePath: issue.path.length ? '/' + issue.path.join('/') : '',
                keyword: issue.code as string,
                message: issue.message,
                params: { issue },
                schemaPath: '#'
              })) as ErrorObject[];
              validationCounters.zodFailure++;
              return false;
            }
            validationCounters.zodFailure++;
            return false;
          }
        },
        errors: null,
        zod: z,
        ajvFn: compiled
      } as CompositeValidator;
      return v;
    }
    return { validate: (d: unknown) => compiled(d), errors: null } as unknown as ValidatorEntry;
  } catch { return null; }
}

/**
 * Validate request parameters against the registered JSON Schema (or Zod schema) for `method`.
 * Returns `{ ok: true }` when no schema is registered (fail-open) or when validation passes.
 * @param method - JSON-RPC method name whose schema should be used for validation
 * @param params - Parameter value received from the caller (may be `undefined`)
 * @returns `{ ok: true }` on success, or `{ ok: false; errors: ErrorObject[] }` on failure
 */
export function validateParams(method: string, params: unknown): { ok: true } | { ok: false; errors: ErrorObject[] } {
  let entry = cache.get(method);
  if(entry === undefined){ entry = buildValidator(method); cache.set(method, entry); }
  if(!entry) return { ok: true }; // no schema => accept
  const { forceAjv } = resolveValidationSettings();
  const ok = entry.validate(params === undefined ? {} : params);
  const hasZod = (entry as CompositeValidator).zod !== undefined && !forceAjv;
  if(ok){
    if(hasZod){ validationCounters.zodSuccess++; } else { validationCounters.ajvSuccess++; }
    return { ok: true };
  }
  if(hasZod){ validationCounters.zodFailure++; } else { validationCounters.ajvFailure++; }
  const v: unknown = entry.validate;
  const errors = (v && typeof v === 'object' && 'errors' in (v as Record<string,unknown>)) ? (v as { errors?: ErrorObject[] }).errors || [] : [];
  return { ok: false, errors };
}

/** Evict all cached validators, forcing re-compilation on the next call to {@link validateParams}. */
export function clearValidationCache(){ cache.clear(); }

/**
 * Return a snapshot of the validation counters for use in metrics reporting.
 * @returns Copy of the current Zod vs. Ajv success/failure counters and active mode
 */
export function getValidationMetrics(){ return { ...validationCounters }; }
