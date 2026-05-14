import canonicalSchema from '../../schemas/instruction.schema.json';

// ─────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH FOR ALL INSTRUCTION-SCHEMA ENUMS
// ─────────────────────────────────────────────────────────────────────
// The JSON schema (schemas/instruction.schema.json) is canonical.
// The TS literal tuples below exist ONLY so consumers get narrow
// type inference. A single parity guard runs at module load and throws
// if any tuple disagrees (in length, order, or values) with the JSON
// schema enum at the corresponding property path. This means:
//   • any stale build, stale dist/, or stale running server fails loud
//     the moment the module is imported;
//   • adding/removing a value in JSON without updating the TS tuple
//     (or vice versa) breaks every test and every server start with a
//     specific error message identifying the offending field.
// Do NOT add a new schema enum without also adding its tuple + a row
// to ENUM_GUARDS below.

function readSchemaEnum(field: string): readonly string[] {
  const e = (canonicalSchema as { properties?: Record<string, { enum?: unknown }> })
    .properties?.[field]?.enum;
  if (!Array.isArray(e) || e.some(v => typeof v !== 'string')) {
    throw new Error(
      `schemas/instruction.schema.json: properties.${field}.enum is missing or not a string[]`,
    );
  }
  return e as string[];
}

export const CONTENT_TYPES = [
  'agent', 'skill', 'instruction', 'prompt',
  'workflow', 'knowledge', 'template', 'integration',
] as const;
export type ContentType = typeof CONTENT_TYPES[number];

export const AUDIENCES = ['individual', 'group', 'all'] as const;
export type AudienceScope = typeof AUDIENCES[number];

export const REQUIREMENTS = [
  'mandatory', 'critical', 'recommended', 'optional', 'deprecated',
] as const;
export type RequirementLevel = typeof REQUIREMENTS[number];

export const STATUSES = ['draft', 'review', 'approved', 'deprecated'] as const;
export type GovernanceStatus = typeof STATUSES[number];

export const PRIORITY_TIERS = ['P1', 'P2', 'P3', 'P4'] as const;
export type PriorityTier = typeof PRIORITY_TIERS[number];

export const CLASSIFICATIONS = ['public', 'internal', 'restricted'] as const;
export type Classification = typeof CLASSIFICATIONS[number];

// Archive lifecycle enums (schema v7). These cover the closed `archiveReason`
// and `archiveSource` taxonomies introduced by spec 006-archive-lifecycle
// (REQ-3). The runtime values are governed by the JSON schema (single source
// of truth); the tuples below exist only so consumers get narrow types and so
// the parity guard below detects drift between TS and JSON.
export const ARCHIVE_REASONS = [
  'deprecated', 'superseded', 'duplicate-merge', 'manual', 'legacy-scope',
] as const;
export type ArchiveReason = typeof ARCHIVE_REASONS[number];

export const ARCHIVE_SOURCES = [
  'groom', 'remove', 'archive', 'import-migration',
] as const;
export type ArchiveSource = typeof ARCHIVE_SOURCES[number];

// Single parity guard for every schema enum. Adding a new schema enum
// is a one-line change here — and that addition is also enforced by
// the enumSourceOfTruth.spec.ts coverage test, which fails if any
// schema enum field is missing from this table.
const ENUM_GUARDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['contentType', CONTENT_TYPES],
  ['audience', AUDIENCES],
  ['requirement', REQUIREMENTS],
  ['status', STATUSES],
  ['priorityTier', PRIORITY_TIERS],
  ['classification', CLASSIFICATIONS],
  ['archiveReason', ARCHIVE_REASONS],
  ['archiveSource', ARCHIVE_SOURCES],
];

{
  for (const [field, tuple] of ENUM_GUARDS) {
    const schemaEnum = readSchemaEnum(field);
    if (
      schemaEnum.length !== tuple.length ||
      !tuple.every((v, i) => schemaEnum[i] === v)
    ) {
      throw new Error(
        `Schema enum drift on "${field}": src/models/instruction.ts and ` +
        `schemas/instruction.schema.json disagree. ` +
        `TS=[${tuple.join(', ')}] JSON=[${schemaEnum.join(', ')}]. ` +
        'The JSON schema is canonical — update src/models/instruction.ts to match, ' +
        'or rebuild dist/ if you are running a stale binary.',
      );
    }
  }
}

export interface InstructionEntry {
  id: string;
  title: string;
  body: string;
  rationale?: string;
  priority: number; // 1 (highest) .. 100 (lowest)
  audience: AudienceScope;
  requirement: RequirementLevel;
  categories: string[];
  contentType: ContentType; // Content type classification (schema v3+)
  // Primary category (enterprise governance): canonical single category driving ownership & review.
  // Must also appear in categories[]. Added in schema v3.
  primaryCategory?: string;
  sourceHash: string; // content hash for integrity
  schemaVersion: string;
  deprecatedBy?: string;
  createdAt: string;
  updatedAt: string;
  usageCount?: number;
  firstSeenTs?: string; // timestamp when usage first observed (Phase 1 index property)
  lastUsedAt?: string;
  riskScore?: number; // derived metric
  // Structured scoping fields (optional)
  workspaceId?: string; // originating workspace / project identifier
  userId?: string;      // originating user (creator / owner) identifier
  teamIds?: string[];   // one or more team identifiers
  // Governance & lifecycle (added in 0.7.0 schema)
  version?: string;           // semantic content version of this instruction
  status?: GovernanceStatus;
  owner?: string;             // responsible owner (user or team slug)
  priorityTier?: PriorityTier; // derived from priority & requirement
  classification?: Classification;
  lastReviewedAt?: string;    // timestamp of last manual review
  nextReviewDue?: string;     // scheduled review date
  reviewIntervalDays?: number; // persisted review interval (schema v2)
  changeLog?: { version: string; changedAt: string; summary: string }[]; // chronological changes
  supersedes?: string;        // id of instruction this one supersedes
  archivedAt?: string;        // timestamp when archived (schema v2, placeholder)
  // Archive lifecycle metadata (schema v7 — spec 006-archive-lifecycle, REQ-3).
  // All four fields are optional; they are populated by the archive workflow
  // and absent on active entries.
  archivedBy?: string;          // identifier of the agent / operator that archived this entry
  archiveReason?: ArchiveReason; // closed enum: why the entry was archived
  archiveSource?: ArchiveSource; // which lifecycle pathway produced the archive event
  restoreEligible?: boolean;     // whether the entry may be restored (default true; false locks it)
  // Content intelligence (optional)
  semanticSummary?: string;   // concise summary / first-sentence style abstract of body
  // Attribution (added in 0.8.x): who/where created the instruction
  createdByAgent?: string;     // identifier of the MCP agent / client that created this entry
  sourceWorkspace?: string;    // logical workspace/project identifier at creation time
  extensions?: Record<string, unknown>; // vendor / experimental metadata
}
