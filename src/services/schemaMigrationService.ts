import { SCHEMA_VERSION } from '../versioning/schemaVersion';
import { REQUIREMENTS } from '../models/instruction';
import { log } from './logger';

export interface SchemaMigrationChange {
  field: string;
  from?: unknown;
  to: unknown;
  reason: string;
}

export interface SchemaMigrationResult {
  entry: Record<string, unknown>;
  changed: boolean;
  originalId?: string;
  id?: string;
  schemaVersion?: string;
  changes: SchemaMigrationChange[];
}

export interface SchemaMigrationOptions {
  source: 'index_import' | 'index_repair';
  log?: boolean;
}

const VALID_ID = /^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$/;
const PATH_TRAVERSAL_OR_SEPARATOR = /(?:^|[\\/])\.\.(?:[\\/]|$)|[\\/]/;

const LEGACY_AUDIENCE: Record<string, 'group' | 'all'> = {
  team: 'group',
  developers: 'group',
  devs: 'group',
  'squad-coordinator': 'group',
  'support-engineer': 'group',
  agent: 'all',
  agents: 'all',
};

function cloneEntry(entry: Record<string, unknown>): Record<string, unknown> {
  return { ...entry };
}

function recordChange(changes: SchemaMigrationChange[], field: string, from: unknown, to: unknown, reason: string): void {
  if (from === to) return;
  changes.push({ field, from, to, reason });
}

function normalizeLegacyId(id: string): string | undefined {
  if (PATH_TRAVERSAL_OR_SEPARATOR.test(id)) return undefined;
  const normalized = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/[-_]{2,}/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '')
    .slice(0, 120)
    .replace(/[^a-z0-9]+$/, '');
  return normalized || undefined;
}

function migrateAudience(entry: Record<string, unknown>, changes: SchemaMigrationChange[]): void {
  if (typeof entry.audience !== 'string') {
    if (entry.audience === undefined || entry.audience === null) {
      recordChange(changes, 'audience', entry.audience, 'all', 'missing audience default');
      entry.audience = 'all';
    }
    return;
  }
  const key = entry.audience.trim().toLowerCase();
  const mapped = LEGACY_AUDIENCE[key];
  if (mapped) {
    recordChange(changes, 'audience', entry.audience, mapped, 'legacy audience alias');
    entry.audience = mapped;
  }
}

function migrateRequirement(entry: Record<string, unknown>, changes: SchemaMigrationChange[]): void {
  if (typeof entry.requirement !== 'string') {
    if (entry.requirement === undefined || entry.requirement === null) {
      recordChange(changes, 'requirement', entry.requirement, 'recommended', 'missing requirement default');
      entry.requirement = 'recommended';
    }
    return;
  }
  const normalized = entry.requirement.trim().toLowerCase();
  if ((REQUIREMENTS as readonly string[]).includes(normalized)) {
    if (normalized !== entry.requirement) {
      recordChange(changes, 'requirement', entry.requirement, normalized, 'normalized requirement case');
      entry.requirement = normalized;
    }
    return;
  }
  const mapped = normalized.includes('must') ? 'mandatory' : 'recommended';
  recordChange(changes, 'requirement', entry.requirement, mapped, 'legacy requirement free text');
  entry.requirement = mapped;
}

function migrateContentType(entry: Record<string, unknown>, changes: SchemaMigrationChange[]): void {
  if (entry.contentType === undefined || entry.contentType === null || entry.contentType === '') {
    recordChange(changes, 'contentType', entry.contentType, 'instruction', 'missing contentType default');
    entry.contentType = 'instruction';
    return;
  }
  if (typeof entry.contentType === 'string' && entry.contentType.trim().toLowerCase() === 'reference') {
    recordChange(changes, 'contentType', entry.contentType, 'knowledge', 'legacy contentType reference');
    entry.contentType = 'knowledge';
  }
}

function migrateId(entry: Record<string, unknown>, changes: SchemaMigrationChange[]): void {
  if (typeof entry.id !== 'string' || VALID_ID.test(entry.id)) return;
  const normalized = normalizeLegacyId(entry.id);
  if (!normalized || !VALID_ID.test(normalized)) return;
  recordChange(changes, 'id', entry.id, normalized, 'legacy id normalization');
  entry.id = normalized;
}

function migrateVersionSpecific(entry: Record<string, unknown>, changes: SchemaMigrationChange[]): void {
  const version = typeof entry.schemaVersion === 'string' ? entry.schemaVersion : undefined;
  const categories = Array.isArray(entry.categories)
    ? entry.categories.filter((category): category is string => typeof category === 'string' && category.trim().length > 0)
    : [];
  if ((version === undefined || version === '1') && entry.reviewIntervalDays === undefined) {
    recordChange(changes, 'reviewIntervalDays', entry.reviewIntervalDays, 90, 'legacy schema review interval default');
    entry.reviewIntervalDays = 90;
  }
  if ((version === undefined || version === '1' || version === '2') && entry.primaryCategory === undefined && categories.length > 0) {
    recordChange(changes, 'primaryCategory', entry.primaryCategory, categories[0], 'legacy schema primary category default');
    entry.primaryCategory = categories[0];
  }
}

export function migrateLegacyInstructionEntry(
  rawEntry: Record<string, unknown>,
  options: SchemaMigrationOptions,
): SchemaMigrationResult {
  const entry = cloneEntry(rawEntry);
  const changes: SchemaMigrationChange[] = [];
  const originalId = typeof rawEntry.id === 'string' ? rawEntry.id : undefined;

  migrateVersionSpecific(entry, changes);
  migrateId(entry, changes);
  if (entry.priority === undefined || entry.priority === null) {
    recordChange(changes, 'priority', entry.priority, 50, 'missing priority default');
    entry.priority = 50;
  }
  migrateAudience(entry, changes);
  migrateRequirement(entry, changes);
  migrateContentType(entry, changes);

  const result: SchemaMigrationResult = {
    entry,
    changed: changes.length > 0,
    originalId,
    id: typeof entry.id === 'string' ? entry.id : undefined,
    schemaVersion: typeof rawEntry.schemaVersion === 'string' ? rawEntry.schemaVersion : undefined,
    changes,
  };

  if (result.changed && options.log !== false) {
    log('WARN', '[schema-migration] entry migrated', {
      detail: JSON.stringify({
        source: options.source,
        originalId: result.originalId,
        id: result.id,
        schemaVersion: result.schemaVersion ?? 'unknown',
        changes: result.changes,
        targetSchemaVersion: SCHEMA_VERSION,
      }),
    });
  }

  return result;
}
