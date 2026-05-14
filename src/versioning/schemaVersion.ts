// Central schema version constant for instruction JSON files.
// Bump this when making a backward-incompatible on-disk schema change that
// requires a migration rewrite. Migration logic should detect older versions
// and transform + persist them once.
export const SCHEMA_VERSION = '7';

import { RequirementLevel, AUDIENCES, REQUIREMENTS, STATUSES, PRIORITY_TIERS, CLASSIFICATIONS, PriorityTier } from '../models/instruction';

export interface MigrationResult { changed: boolean; notes?: string[] }

// Helper function for review interval computation (matches ClassificationService logic)
function computeReviewIntervalDays(tier: PriorityTier, requirement: RequirementLevel): number {
  // Shorter intervals for higher criticality
  if(tier === 'P1' || requirement === 'mandatory' || requirement === 'critical') return 30;
  if(tier === 'P2') return 60;
  if(tier === 'P3') return 90;
  return 120;
}

// Migration hook for schema version upgrades
export function migrateInstructionRecord(rec: Record<string, unknown>): MigrationResult {
  const notes: string[] = [];
  let changed = false;

  const prevVersion = rec.schemaVersion || '1';

  // v1 → v2 migration: Add reviewIntervalDays if missing
  if (prevVersion === '1' && !rec.reviewIntervalDays) {
    const tier = (rec.priorityTier as PriorityTier) || 'P4';
    const requirement = (rec.requirement as RequirementLevel) || 'optional';
    rec.reviewIntervalDays = computeReviewIntervalDays(tier, requirement);
    changed = true;
    notes.push('added reviewIntervalDays from tier+requirement');
  }

  // v2 → v3 migration: Introduce primaryCategory (first category if present)
  if (prevVersion === '2') {
    const cats = Array.isArray(rec.categories) ? (rec.categories as unknown[]).filter(c=> typeof c==='string' && c.trim()) as string[] : [];
    if (!('primaryCategory' in rec) && cats.length) {
      (rec as Record<string, unknown>).primaryCategory = cats[0];
      changed = true;
      notes.push('added primaryCategory from first categories element');
    }
    if (('primaryCategory' in rec) && cats.length) {
      const pc = (rec as Record<string, unknown>).primaryCategory as string;
      if (typeof pc === 'string' && pc && !cats.includes(pc)) {
        // ensure consistency: inject primaryCategory into categories array
        cats.unshift(pc);
        (rec as Record<string, unknown>).categories = Array.from(new Set(cats));
        changed = true;
        notes.push('normalized categories to include primaryCategory');
      }
    }
  }

  // v3 → v4 migration: Schema now accepts optional root-level metadata fields such as
  // sourceWorkspace, createdByAgent, and later optional metadata extensions.
  // No data transforms needed — these fields remain optional. Just version bump.
  if (prevVersion === '3') {
    // no-op: optional metadata fields are already valid if present
    notes.push('v3→v4: added optional metadata fields to schema');
  }

  // v6 → v7 migration (spec 006-archive-lifecycle, REQ-25). The new archive
  // metadata fields (archivedBy, archiveReason, archiveSource, restoreEligible)
  // are all optional, so loading a v6 record requires no data transforms.
  // The trailing rewrite-on-write step below stamps schemaVersion='7' on the
  // first persistence, mirroring the v3→v4 silent bump pattern.
  if (prevVersion === '6') {
    // no-op on read: schema v7 fields are optional and absent on legacy records
    notes.push('v6→v7: archive lifecycle metadata is optional, no transform needed');
  }

  // Clean optional nullable fields that upstream tools may emit as null
  // (riskScore must be number or absent — null causes AJV rejection)
  if ('riskScore' in rec && rec.riskScore === null) {
    delete rec.riskScore;
    changed = true;
    notes.push('removed null riskScore (optional field)');
  }

  // Ensure contentType field (backward compatibility default)
  if (!('contentType' in rec) || !rec.contentType) {
    rec.contentType = 'instruction';
    changed = true;
    notes.push('added contentType with default value "instruction"');
  }

  // Ensure all required fields are present (defensive migration)
  const requiredDefaults: Record<string, unknown> = {
    categories: [],
    priority: 50,
    audience: 'all',
    requirement: 'recommended'
  };
  for (const [key, defaultValue] of Object.entries(requiredDefaults)) {
    if (!(key in rec) || rec[key] === undefined || rec[key] === null) {
      rec[key] = defaultValue;
      changed = true;
      notes.push(`added required field ${key} with default value`);
    }
  }

  // Validate and coerce enum fields to prevent invalid values from persisting.
  // Legacy alias maps mirror indexLoader.ts coercion — try known aliases first,
  // only fall back to defaults for truly unknown values. Keep in sync with indexLoader.ts.
  const legacyStatusMap: Record<string, string> = { active: 'approved' };
  const legacyAudienceMap: Record<string, string> = {
    system: 'all', developers: 'group', developer: 'individual',
    team: 'group', teams: 'group', users: 'group', dev: 'individual',
    devs: 'group', testers: 'group', administrators: 'group',
    admins: 'group', agents: 'group', 'powershell script authors': 'group',
  };
  const legacyRequirementMap: Record<string, string> = {
    MUST: 'mandatory', SHOULD: 'recommended', MAY: 'optional',
    CRITICAL: 'critical', OPTIONAL: 'optional', MANDATORY: 'mandatory',
    DEPRECATED: 'deprecated', REQUIRED: 'mandatory',
  };
  const enumDefaults: Record<string, { valid: readonly string[]; fallback: string; legacy?: Record<string, string> }> = {
    audience: { valid: AUDIENCES, fallback: 'all', legacy: legacyAudienceMap },
    requirement: { valid: REQUIREMENTS, fallback: 'optional', legacy: legacyRequirementMap },
    status: { valid: STATUSES, fallback: 'draft', legacy: legacyStatusMap },
    priorityTier: { valid: PRIORITY_TIERS, fallback: 'P3' },
    classification: { valid: CLASSIFICATIONS, fallback: 'internal' },
  };
  for (const [field, { valid, fallback, legacy }] of Object.entries(enumDefaults)) {
    if (typeof rec[field] === 'string' && !(valid as readonly string[]).includes(rec[field] as string)) {
      const val = rec[field] as string;
      // Try legacy alias maps (exact match then case-insensitive) before falling back to default
      const resolved = legacy?.[val] ?? legacy?.[val.toLowerCase()] ?? legacy?.[val.toUpperCase()];
      const target = resolved ?? (field === 'requirement' && /\s/.test(val) && val.length < 300 ? 'recommended' : fallback);
      notes.push(`corrected invalid ${field} "${val}" → "${target}"`);
      rec[field] = target;
      changed = true;
    }
  }

  // Update schema version if changed
  if(rec.schemaVersion !== SCHEMA_VERSION){
    rec.schemaVersion = SCHEMA_VERSION;
    changed = true;
    notes.push(`schemaVersion updated ${prevVersion}→${SCHEMA_VERSION}`);
  }

  return { changed, notes: notes.length? notes: undefined };
}
