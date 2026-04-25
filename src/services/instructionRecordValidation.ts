import Ajv, { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';
import { InstructionEntry } from '../models/instruction';
import { instructionEntry } from '../schemas';
import { ClassificationService } from './classificationService';

const INPUT_SCHEMA_REF = 'index_add#input';
const REQUIRED_RECORD_KEYS = new Set([
  'id',
  'title',
  'body',
  'priority',
  'audience',
  'requirement',
  'categories',
  'sourceHash',
  'schemaVersion',
  'createdAt',
  'updatedAt',
  'version',
  'status',
  'owner',
  'priorityTier',
  'classification',
  'lastReviewedAt',
  'nextReviewDue',
  'changeLog',
  'semanticSummary',
]);
const ALLOWED_INPUT_KEYS = new Set([
  'id',
  'title',
  'body',
  'rationale',
  'priority',
  'audience',
  'requirement',
  'categories',
  'primaryCategory',
  'deprecatedBy',
  'riskScore',
  'reviewIntervalDays',
  'version',
  'owner',
  'status',
  'priorityTier',
  'classification',
  'lastReviewedAt',
  'nextReviewDue',
  'changeLog',
  'semanticSummary',
  'contentType',
  'extensions',
  'supersedes',
  'createdByAgent',
  'sourceWorkspace',
  'mode',
  'lax',
]);

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
try {
  if (!ajv.getSchema('https://json-schema.org/draft-07/schema')) {
    ajv.addMetaSchema(draft7MetaSchema, 'https://json-schema.org/draft-07/schema');
  }
} catch {
  // Non-fatal; loader uses the same best-effort registration pattern.
}
const validateInstructionSchema = ajv.compile(JSON.parse(JSON.stringify(instructionEntry)) as object);

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
    out[childKey] = stripUndefinedAndOptionalNulls(childValue, childKey, depth + 1);
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

function validateIdSurface(id: unknown): string[] {
  if (typeof id !== 'string' || !id.trim()) return ['id: missing required field'];
  if (id.includes('..') || id.includes('/') || id.includes('\\') || /[:*?"<>|]/.test(id)) {
    return ['id: must be a safe instruction id without path traversal or path separators'];
  }
  return [];
}

export function validateInstructionInputSurface(entry: Record<string, unknown>): InstructionValidationResult {
  const validationErrors: string[] = [];
  validationErrors.push(...validateIdSurface(entry.id));
  for (const key of Object.keys(entry)) {
    if (!ALLOWED_INPUT_KEYS.has(key)) {
      validationErrors.push(`/: unexpected property "${key}"`);
      continue;
    }
    if (entry[key] === null) validationErrors.push(`/${key}: null is not allowed`);
  }
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
  if (record.contentType !== undefined && !['instruction', 'template', 'chat-session', 'reference', 'example', 'agent'].includes(record.contentType)) {
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

export { INPUT_SCHEMA_REF as INSTRUCTION_INPUT_SCHEMA_REF };
