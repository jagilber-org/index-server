// Central schema version constant for instruction JSON files.
// Bump this when making a backward-incompatible on-disk schema change that
// requires a migration rewrite. Migration logic should detect older versions
// and transform + persist them once.
export const SCHEMA_VERSION = '4';

import { RequirementLevel } from '../models/instruction';

export interface MigrationResult { changed: boolean; notes?: string[] }

// Helper function for review interval computation (matches ClassificationService logic)
function computeReviewIntervalDays(tier: 'P1'|'P2'|'P3'|'P4', requirement: RequirementLevel): number {
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
    const tier = (rec.priorityTier as 'P1'|'P2'|'P3'|'P4') || 'P4';
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

  // v3 → v4 migration: Schema now accepts sourceWorkspace & createdByAgent at root level.
  // No data transforms needed — fields are optional. Just version bump.
  if (prevVersion === '3') {
    // no-op: new optional fields (sourceWorkspace, createdByAgent) already valid if present
    notes.push('v3→v4: added sourceWorkspace & createdByAgent to schema (optional)');
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
    requirement: 'optional'
  };
  for (const [key, defaultValue] of Object.entries(requiredDefaults)) {
    if (!(key in rec) || rec[key] === undefined || rec[key] === null) {
      rec[key] = defaultValue;
      changed = true;
      notes.push(`added required field ${key} with default value`);
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
