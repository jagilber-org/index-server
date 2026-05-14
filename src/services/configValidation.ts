/**
 * Per-flag validator layer (Plan §2.6 T2, #359).
 *
 * `validateFlagUpdate(entry, raw)` returns a discriminated-union result:
 *   - `{ ok:true,  value }`      coerced/normalized canonical value for persistence.
 *   - `{ ok:false, code, error }` machine-readable rejection (READONLY|TYPE|RANGE|ENUM|PATTERN|FORMAT).
 *
 * Rule order (short-circuits on first failure):
 *   1. READONLY    -- editable:false (any readonlyReason) always rejects writes.
 *   2. TYPE        -- coerce raw into the canonical primitive (boolean|number|string).
 *   3. RANGE       -- numeric min/max (numbers only).
 *   4. ENUM        -- exact-match membership (case-sensitive).
 *   5. PATTERN     -- RegExp test against the stringified value.
 *   6. FORMAT      -- url|port|path|duration-ms|host (Morpheus revision #3).
 *
 * Consumers: api-redesign POST handler (per-field result on /api/admin/config).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type FlagValidationResult =
  | { ok: true; value: string | number | boolean }
  | { ok: false; code: 'READONLY' | 'TYPE' | 'RANGE' | 'ENUM' | 'PATTERN' | 'FORMAT'; error: string };

interface FlagValidationRules {
  min?: number;
  max?: number;
  enum?: readonly (string | number)[];
  pattern?: string;
  format?: 'url' | 'port' | 'path' | 'duration-ms' | 'host';
  unit?: string;
}

interface FlagEntryShape {
  name?: string;
  type: 'boolean' | 'number' | 'string';
  editable?: boolean;
  readonlyReason?: string;
  validation?: FlagValidationRules;
}

function coerceBoolean(raw: unknown): boolean | undefined {
  if (raw === true || raw === false) return raw;
  if (raw === 1) return true;
  if (raw === 0) return false;
  if (typeof raw === 'string') {
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
  }
  return undefined;
}

function coerceNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function coerceString(raw: unknown): string | undefined {
  return typeof raw === 'string' ? raw : undefined;
}

type FailCode = 'READONLY' | 'TYPE' | 'RANGE' | 'ENUM' | 'PATTERN' | 'FORMAT';

function fail(code: FailCode, error: string): FlagValidationResult {
  return { ok: false, code, error };
}

function checkFormat(format: NonNullable<FlagValidationRules['format']>, value: string | number): FlagValidationResult | null {
  switch (format) {
    case 'url': {
      const s = String(value);
      try {
        const u = new URL(s);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          return fail('FORMAT', `expected http(s) URL, got protocol ${u.protocol}`);
        }
      } catch {
        return fail('FORMAT', `not a valid URL: ${s}`);
      }
      return null;
    }
    case 'port': {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
        return fail('FORMAT', `expected integer port in [1,65535], got ${value}`);
      }
      return null;
    }
    case 'path': {
      const s = typeof value === 'string' ? value : '';
      if (s.length === 0) return fail('FORMAT', 'path must be non-empty');
      return null;
    }
    case 'duration-ms': {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        return fail('FORMAT', `expected non-negative integer ms, got ${value}`);
      }
      return null;
    }
    case 'host': {
      const s = typeof value === 'string' ? value : '';
      if (s.length === 0 || /\s/.test(s)) return fail('FORMAT', 'host must be non-empty and contain no whitespace');
      return null;
    }
    default:
      return null;
  }
}

/**
 * Single source of truth for the "is this flag mutable from the dashboard?" check.
 * Used by:
 *  - validateFlagUpdate() below (READONLY rule)
 *  - admin.routes.ts POST /admin/config/reset/:flag handler (#359 C1 fix)
 *  - runtimeOverrides.writeOverride() defense-in-depth (#359 H1 fix)
 *
 * `editable:false` always blocks regardless of `readonlyReason`. Sensitive
 * secrets must never be writable via the dashboard API surface.
 */
export function isWriteable(entry: FlagEntryShape | any): boolean {
  if (!entry || typeof entry !== 'object') return false;
  return entry.editable !== false;
}

export function validateFlagUpdate(entry: FlagEntryShape | any, raw: unknown): FlagValidationResult {
  if (!entry || typeof entry !== 'object') {
    return fail('TYPE', 'invalid flag entry');
  }

  // 1. READONLY — editable:false (any readonlyReason) hard-rejects.
  if (entry.editable === false) {
    return fail('READONLY', `flag is readonly (${entry.readonlyReason ?? 'reserved'})`);
  }

  // 2. TYPE coercion.
  const type = entry.type as 'boolean' | 'number' | 'string';
  let value: string | number | boolean;
  if (type === 'boolean') {
    const coerced = coerceBoolean(raw);
    if (coerced === undefined) return fail('TYPE', `expected boolean, got ${describe(raw)}`);
    value = coerced;
  } else if (type === 'number') {
    const coerced = coerceNumber(raw);
    if (coerced === undefined) return fail('TYPE', `expected number, got ${describe(raw)}`);
    value = coerced;
  } else {
    const coerced = coerceString(raw);
    if (coerced === undefined) return fail('TYPE', `expected string, got ${describe(raw)}`);
    value = coerced;
  }

  const v = entry.validation as FlagValidationRules | undefined;
  if (v) {
    // 3. RANGE
    if (typeof value === 'number') {
      if (v.min !== undefined && value < v.min) return fail('RANGE', `${value} < min ${v.min}`);
      if (v.max !== undefined && value > v.max) return fail('RANGE', `${value} > max ${v.max}`);
    }
    // 4. ENUM
    if (v.enum && v.enum.length > 0) {
      if (!v.enum.includes(value as never)) {
        return fail('ENUM', `value ${JSON.stringify(value)} not in enum`);
      }
    }
    // 5. PATTERN
    if (v.pattern) {
      let re: RegExp;
      try {
        re = new RegExp(v.pattern);
      } catch {
        return fail('PATTERN', `invalid pattern: ${v.pattern}`);
      }
      if (!re.test(String(value))) return fail('PATTERN', `value does not match ${v.pattern}`);
    }
    // 6. FORMAT
    if (v.format && typeof value !== 'boolean') {
      const fmtResult = checkFormat(v.format, value);
      if (fmtResult) return fmtResult;
    }
  }

  return { ok: true, value };
}

function describe(raw: unknown): string {
  if (raw === null) return 'null';
  if (raw === undefined) return 'undefined';
  if (typeof raw === 'number' && !Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'object') return Array.isArray(raw) ? 'array' : 'object';
  return `${typeof raw}(${JSON.stringify(raw)})`;
}
