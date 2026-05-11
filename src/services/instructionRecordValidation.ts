import { ErrorObject } from 'ajv';
import { CONTENT_TYPES, InstructionEntry } from '../models/instruction';
import {
  validateRecord as validateInstructionSchema,
  REQUIRED_RECORD_KEYS,
  INPUT_KEYS as ALLOWED_INPUT_KEYS,
  INSTRUCTION_INPUT_SCHEMA_REF,
} from '../schemas/instructionSchema';
import { ClassificationService } from './classificationService';

const INPUT_SCHEMA_REF = INSTRUCTION_INPUT_SCHEMA_REF;
// REQUIRED_RECORD_KEYS, ALLOWED_INPUT_KEYS, and the compiled
// validateInstructionSchema are imported from src/schemas/instructionSchema.ts,
// which derives them from schemas/instruction.schema.json. Do not restate the
// schema here — the prior hand-maintained copies drifted (they required 21
// fields while the canonical schema required 8) and broke export→import
// round-trips.
//
// CONTROL_KEYS are transport-layer flags that callers historically inlined
// into the entry object as a convenience (instead of into the RPC params
// bag). They are not data fields and are deliberately not part of the
// canonical schema. The surface validator tolerates them but does not
// forward them to record validation.
const CONTROL_KEYS = new Set(['mode', 'lax']);

export interface InstructionValidationResult {
  record: InstructionEntry;
  validationErrors: string[];
  hints: string[];
  schemaRef: string;
}

export class InstructionValidationError extends Error {
  readonly code = 'invalid_instruction';

  constructor(
    public readonly validationErrors: string[],
    public readonly hints: string[] = [],
    public readonly schemaRef: string = INPUT_SCHEMA_REF,
  ) {
    super(`invalid_instruction: ${validationErrors.join('; ')}`);
    this.name = 'InstructionValidationError';
  }
}

function normalizePath(path: string): string {
  return path || '/';
}

function formatAjvError(error: ErrorObject): string {
  const instancePath = normalizePath(error.instancePath);
  if (error.keyword === 'additionalProperties') {
    const prop = (error.params as { additionalProperty?: string }).additionalProperty;
    return `${instancePath}: unexpected property "${prop}"`;
  }
  if (error.keyword === 'required') {
    const prop = (error.params as { missingProperty?: string }).missingProperty;
    return `${instancePath}: missing required property "${prop}"`;
  }
  if (error.keyword === 'enum') {
    const allowed = Array.isArray((error.params as { allowedValues?: unknown[] }).allowedValues)
      ? ((error.params as { allowedValues?: unknown[] }).allowedValues ?? []).join(', ')
      : 'allowed enum values';
    return `${instancePath}: must be one of ${allowed}`;
  }
  if (error.keyword === 'type') {
    const expected = (error.params as { type?: string }).type ?? 'the expected type';
    return `${instancePath}: must be ${expected}`;
  }
  if (error.keyword === 'minLength') return `${instancePath}: must not be empty`;
  if (error.keyword === 'maxLength') return `${instancePath}: exceeds the allowed maximum length`;
  if (error.keyword === 'minimum') return `${instancePath}: must be greater than or equal to ${(error.params as { comparison?: number }).comparison ?? 'the minimum'}`;
  if (error.keyword === 'maximum') return `${instancePath}: must be less than or equal to ${(error.params as { comparison?: number }).comparison ?? 'the maximum'}`;
  return `${instancePath}: ${error.message ?? 'failed validation'}`;
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items));
}

function buildHints(validationErrors: string[]): string[] {
  const hints = [
    'Instruction not added. Fix the listed validation errors and retry.',
    'Use the returned inputSchema as the authoritative contract for index_add.',
  ];
  if (validationErrors.some((msg) => msg.includes('missing required property') || msg.includes('missing required field'))) {
    hints.push('Provide all required fields for strict add/import calls, especially id, title, and body.');
  }
  if (validationErrors.some((msg) => msg.includes('must be one of') || msg.includes('invalid value'))) {
    hints.push('Use documented enum values for fields like audience, requirement, status, priorityTier, classification, and contentType.');
  }
  if (validationErrors.some((msg) => msg.includes('unexpected property'))) {
    hints.push('Remove unsupported properties instead of sending fields that are not part of the instruction schema.');
  }
  if (validationErrors.some((msg) => msg.includes('/extensions') || msg.includes('extensions'))) {
    hints.push('extensions must be a JSON object whose values are strings, numbers, booleans, arrays, or nested objects; null is not allowed.');
  }
  if (validationErrors.some((msg) => msg.includes('null is not allowed'))) {
    hints.push('Replace null values with a valid value or omit the optional field entirely.');
  }
  return dedupe(hints);
}

function stripUndefinedAndOptionalNulls(value: unknown, key?: string, depth = 0): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedAndOptionalNulls(item, undefined, depth + 1)).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (childValue === undefined) continue;
    if (childValue === null && depth === 0 && !REQUIRED_RECORD_KEYS.has(childKey)) continue;
    out[childKey] = stripUndefinedAndOptionalNulls(childValue, childKey, depth + 1); // lgtm[js/remote-property-injection] — childKey is own-property of caller-controlled entry; schema rejects unknown top-level keys downstream
  }
  if (key && Object.keys(out).length === 0 && !REQUIRED_RECORD_KEYS.has(key)) return undefined;
  return out;
}

function applyWriteCompatibility(entry: InstructionEntry): InstructionEntry {
  const next = stripUndefinedAndOptionalNulls(entry) as InstructionEntry & Record<string, unknown>;
  if ((next.status as string | undefined) === 'active') next.status = 'approved';

  if (next.audience === undefined) next.audience = 'all';
  if (next.requirement === undefined) next.requirement = 'optional';

  if (typeof next.audience === 'string') {
    const legacyAudienceMap: Record<string, InstructionEntry['audience']> = {
      system: 'all',
      developers: 'group',
      developer: 'individual',
      team: 'group',
      teams: 'group',
      users: 'group',
      dev: 'individual',
      devs: 'group',
      testers: 'group',
      administrators: 'group',
      admins: 'group',
      agents: 'group',
      'powershell script authors': 'group',
    };
    const lower = next.audience.toLowerCase();
    if (legacyAudienceMap[next.audience]) next.audience = legacyAudienceMap[next.audience];
    else if (legacyAudienceMap[lower]) next.audience = legacyAudienceMap[lower];
    else if (/author|script\s+author/i.test(lower)) next.audience = 'individual';
  }

  if (typeof next.requirement === 'string') {
    const legacyRequirementMap: Record<string, InstructionEntry['requirement']> = {
      MUST: 'mandatory',
      SHOULD: 'recommended',
      MAY: 'optional',
      CRITICAL: 'critical',
      OPTIONAL: 'optional',
      MANDATORY: 'mandatory',
      DEPRECATED: 'deprecated',
    };
    const upper = next.requirement.toUpperCase();
    if (legacyRequirementMap[next.requirement]) next.requirement = legacyRequirementMap[next.requirement];
    else if (legacyRequirementMap[upper]) next.requirement = legacyRequirementMap[upper];
  }

  if (typeof next.priority !== 'number' || next.priority < 1 || next.priority > 100) next.priority = 50;
  return next;
}

// Matches the upper bound declared in schemas/instruction.schema.json (id maxLength).
export const INSTRUCTION_ID_MAX_LENGTH = 120;
export const INSTRUCTION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$/;

function findIllegalControlChar(id: string): { display: string; code: number } | undefined {
  for (let i = 0; i < id.length; i++) {
    const code = id.charCodeAt(i);
    // Reject ASCII control characters (incl. NUL 0x00) and DEL (0x7F).
    if (code < 0x20 || code === 0x7f) {
      const display = `\\x${code.toString(16).padStart(2, '0')}`;
      return { display, code };
    }
  }
  return undefined;
}

export function validateInstructionIdSurface(id: unknown): string[] {
  if (typeof id !== 'string' || !id.trim()) return ['id: missing required field'];
  const illegal = findIllegalControlChar(id);
  if (illegal) {
    return [`id: contains illegal control character (${illegal.display}) — id-illegal-character`];
  }
  if (id.length > INSTRUCTION_ID_MAX_LENGTH) {
    return [`id: exceeds maximum length of ${INSTRUCTION_ID_MAX_LENGTH} characters (id-too-long)`];
  }
  if (id.includes('..') || id.includes('/') || id.includes('\\') || /[:*?"<>|]/.test(id)) {
    return ['id: must be a safe instruction id without path traversal or path separators'];
  }
  if (!INSTRUCTION_ID_PATTERN.test(id)) {
    return ['id: must match /^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$/ using lower-case ASCII letters, digits, hyphen, or underscore'];
  }
  return [];
}

// Enum membership checks for governance fields. These run at input-surface time so that
// invalid enum values are rejected early, before applyWriteCompatibility can silently
// coerce them (e.g. status:"active" → "approved", audience:"agents" → "group").
// However, values that ARE coercible by applyWriteCompatibility are accepted here to
// avoid rejecting inputs that would otherwise succeed after coercion.
const VALID_STATUS = ['approved', 'draft', 'review', 'deprecated'] as const;
const COERCIBLE_STATUS = ['active'] as const;
const VALID_PRIORITY_TIER = ['P1', 'P2', 'P3', 'P4'] as const;
const VALID_CLASSIFICATION = ['public', 'internal', 'restricted'] as const;
const VALID_CONTENT_TYPE = CONTENT_TYPES;
const VALID_AUDIENCE = ['individual', 'group', 'all'] as const;
const COERCIBLE_AUDIENCE = ['system', 'developers', 'developer', 'team', 'teams', 'users', 'dev', 'devs', 'testers', 'administrators', 'admins', 'agents', 'powershell script authors'] as const;
const VALID_REQUIREMENT = ['mandatory', 'critical', 'recommended', 'optional', 'deprecated'] as const;
const COERCIBLE_REQUIREMENT = ['MUST', 'SHOULD', 'MAY', 'CRITICAL', 'OPTIONAL', 'MANDATORY', 'DEPRECATED'] as const;

export function validateInstructionInputEnumMembership(entry: Record<string, unknown>): string[] {
  const errs: string[] = [];
  if (typeof entry.status === 'string' && !(VALID_STATUS as readonly string[]).includes(entry.status) && !(COERCIBLE_STATUS as readonly string[]).includes(entry.status)) {
    errs.push(`/status: must be one of ${VALID_STATUS.join(', ')}`);
  }
  if (typeof entry.priorityTier === 'string' && !(VALID_PRIORITY_TIER as readonly string[]).includes(entry.priorityTier)) {
    errs.push(`/priorityTier: must be one of ${VALID_PRIORITY_TIER.join(', ')}`);
  }
  if (typeof entry.classification === 'string' && !(VALID_CLASSIFICATION as readonly string[]).includes(entry.classification)) {
    errs.push(`/classification: must be one of ${VALID_CLASSIFICATION.join(', ')}`);
  }
  if (typeof entry.contentType === 'string' && !(VALID_CONTENT_TYPE as readonly string[]).includes(entry.contentType)) {
    errs.push(`/contentType: must be one of ${VALID_CONTENT_TYPE.join(', ')}`);
  }
  if (typeof entry.audience === 'string' && !(VALID_AUDIENCE as readonly string[]).includes(entry.audience) && !(COERCIBLE_AUDIENCE as readonly string[]).includes(entry.audience.toLowerCase() as typeof COERCIBLE_AUDIENCE[number])) {
    errs.push(`/audience: must be one of ${VALID_AUDIENCE.join(', ')}`);
  }
  if (typeof entry.requirement === 'string' && !(VALID_REQUIREMENT as readonly string[]).includes(entry.requirement) && !(COERCIBLE_REQUIREMENT as readonly string[]).includes(entry.requirement.toUpperCase() as typeof COERCIBLE_REQUIREMENT[number])) {
    errs.push(`/requirement: must be one of ${VALID_REQUIREMENT.join(', ')}`);
  }
  return errs;
}

// Typed-field shape checks. These run for both strict and lax callers so that lax mode
// fills defaults for *missing* fields but never silently coerces wrong-typed inputs.
function validateTypedInputShape(entry: Record<string, unknown>): string[] {
  const errs: string[] = [];
  if (entry.priority !== undefined && typeof entry.priority !== 'number') {
    errs.push(`/priority: must be a number, received ${typeof entry.priority}`);
  } else if (typeof entry.priority === 'number' && (!Number.isInteger(entry.priority) || entry.priority < 1 || entry.priority > 100)) {
    errs.push('/priority: must be an integer from 1 to 100');
  }
  if (entry.categories !== undefined && !Array.isArray(entry.categories)) {
    errs.push(`/categories: must be an array of strings, received ${typeof entry.categories}`);
  } else if (Array.isArray(entry.categories)) {
    for (const [index, category] of entry.categories.entries()) {
      if (typeof category !== 'string') {
        errs.push(`/categories/${index}: must be a string, received ${typeof category}`);
      } else if (!/^[a-z0-9][a-z0-9-_]{0,48}$/.test(category)) {
        errs.push(`/categories/${index}: must match /^[a-z0-9][a-z0-9-_]{0,48}$/`);
      }
    }
  }
  if (typeof entry.primaryCategory === 'string' && Array.isArray(entry.categories) && entry.categories.length > 0) {
    if (!(entry.categories as unknown[]).includes(entry.primaryCategory)) {
      errs.push(`/primaryCategory: must be a member of categories[]`);
    }
  }
  if (entry.audience !== undefined && typeof entry.audience !== 'string') {
    errs.push(`/audience: must be a string, received ${typeof entry.audience}`);
  }
  if (entry.requirement !== undefined && typeof entry.requirement !== 'string') {
    errs.push(`/requirement: must be a string, received ${typeof entry.requirement}`);
  }
  if (entry.title !== undefined && typeof entry.title !== 'string') {
    errs.push(`/title: must be a string, received ${typeof entry.title}`);
  }
  if (entry.body !== undefined && typeof entry.body !== 'string') {
    errs.push(`/body: must be a string, received ${typeof entry.body}`);
  }
  if (entry.changeLog !== undefined && !Array.isArray(entry.changeLog)) {
    errs.push(`/changeLog: must be an array, received ${typeof entry.changeLog}`);
  }
  if (entry.extensions !== undefined && (typeof entry.extensions !== 'object' || Array.isArray(entry.extensions))) {
    errs.push(`/extensions: must be an object, received ${Array.isArray(entry.extensions) ? 'array' : typeof entry.extensions}`);
  }
  return errs;
}

export function validateInstructionInputSurface(entry: Record<string, unknown>): InstructionValidationResult {
  const validationErrors: string[] = [];
  validationErrors.push(...validateInstructionIdSurface(entry.id));
  for (const key of Object.keys(entry)) {
    if (CONTROL_KEYS.has(key)) continue; // transport flags; tolerated, not forwarded
    if (!ALLOWED_INPUT_KEYS.has(key)) {
      validationErrors.push(`/: unexpected property "${key}"`);
      continue;
    }
    if (entry[key] === null) validationErrors.push(`/${key}: null is not allowed`);
  }
  validationErrors.push(...validateTypedInputShape(entry));
  validationErrors.push(...validateInstructionInputEnumMembership(entry));
  return {
    record: entry as unknown as InstructionEntry,
    validationErrors: dedupe(validationErrors),
    hints: buildHints(validationErrors),
    schemaRef: INPUT_SCHEMA_REF,
  };
}

export function validateInstructionRecord(entry: InstructionEntry): InstructionValidationResult {
  const record = applyWriteCompatibility(entry);
  const validationErrors: string[] = [];

  if (record.status !== undefined && !['draft', 'review', 'approved', 'deprecated'].includes(record.status)) {
    validationErrors.push(`/status: invalid value "${String(record.status)}"`);
  }
  if (record.priorityTier !== undefined && !['P1', 'P2', 'P3', 'P4'].includes(record.priorityTier)) {
    validationErrors.push(`/priorityTier: invalid value "${String(record.priorityTier)}"`);
  }
  if (record.classification !== undefined && !['public', 'internal', 'restricted'].includes(record.classification)) {
    validationErrors.push(`/classification: invalid value "${String(record.classification)}"`);
  }
  if (record.contentType !== undefined && !(CONTENT_TYPES as readonly string[]).includes(record.contentType)) {
    validationErrors.push(`/contentType: invalid value "${String(record.contentType)}"`);
  }

  if (!validateInstructionSchema(record)) {
    validationErrors.push(...(validateInstructionSchema.errors ?? []).map(formatAjvError));
  }

  const classifierIssues = new ClassificationService().validate(record);
  validationErrors.push(...classifierIssues.map((issue) => `/: ${issue}`));
  if (typeof record.title === 'string' && !record.title.trim()) validationErrors.push('/title: must not be empty');
  if (typeof record.body === 'string' && !record.body.trim()) validationErrors.push('/body: must not be empty');

  return {
    record,
    validationErrors: dedupe(validationErrors),
    hints: buildHints(validationErrors),
    schemaRef: INPUT_SCHEMA_REF,
  };
}

export function assertValidInstructionRecord(entry: InstructionEntry): InstructionEntry {
  const validation = validateInstructionRecord(entry);
  if (validation.validationErrors.length) {
    throw new InstructionValidationError(validation.validationErrors, validation.hints, validation.schemaRef);
  }
  return validation.record;
}

export function isInstructionValidationError(error: unknown): error is InstructionValidationError {
  return error instanceof InstructionValidationError
    || (typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error as { code?: unknown }).code === 'invalid_instruction'
      && Array.isArray((error as { validationErrors?: unknown }).validationErrors));
}

export type LoadErrorCode = 'load_failed' | 'parse_failed' | 'unknown';

export interface SanitizedLoadError {
  code: LoadErrorCode;
  detail: string;
  raw: string;
}

const NODE_FS_ERROR_CODES = /\b(ENOENT|EACCES|EEXIST|EISDIR|ENOTDIR|EPERM|EBUSY|EMFILE|ENFILE|EROFS|ENOSPC|EAGAIN|EFAULT|EINVAL|EIO|ELOOP)\b[:,]?\s*/g;

/**
 * Strip absolute paths, Node fs error codes, quoted path arguments, and
 * stack traces from a free-form error message. Used to keep client-facing
 * error responses free of filesystem layout or internal details.
 */
export function sanitizeErrorDetail(message: string): string {
  if (!message) return '';
  // Truncate to first line — drops stack traces.
  let s = String(message).split('\n')[0];
  // Quoted path arguments (single and double quotes), e.g. open 'C:\\x.json'.
  s = s.replace(/'[^']*[\\/][^']*'/g, "'<redacted-path>'");
  s = s.replace(/"[^"]*[\\/][^"]*"/g, '"<redacted-path>"');
  // Windows absolute paths.
  s = s.replace(/[A-Za-z]:\\[^\s'"`]+/g, '<redacted-path>');
  // Unix absolute paths with at least two segments.
  s = s.replace(/\/(?:[^\s/'"`]+\/)+[^\s/'"`]+/g, '<redacted-path>');
  // Node fs error codes (after path stripping so we don't break boundaries).
  s = s.replace(NODE_FS_ERROR_CODES, '');
  // Collapse whitespace and stray punctuation.
  s = s.replace(/\s+/g, ' ').replace(/^[\s:,;-]+/, '').replace(/[\s:,;-]+$/, '').trim();
  return s;
}

/**
 * Convert an arbitrary error from the existing-entry load path into a
 * client-safe shape. The `raw` field is preserved for internal audit logging
 * only; never echo it directly to clients.
 */
export function sanitizeLoadError(err: unknown, kind: LoadErrorCode = 'load_failed'): SanitizedLoadError {
  const raw = err instanceof Error ? (err.message ?? '') : (typeof err === 'string' ? err : '');
  let detail = sanitizeErrorDetail(raw);
  if (!detail) {
    detail = kind === 'parse_failed'
      ? 'invalid JSON in existing entry'
      : kind === 'load_failed'
        ? 'unable to read existing entry'
        : 'unknown load error';
  }
  return { code: kind, detail, raw };
}

export { INPUT_SCHEMA_REF as INSTRUCTION_INPUT_SCHEMA_REF };
