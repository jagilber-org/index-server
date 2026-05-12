import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { registerHandler } from '../../server/registry';
import { ensureLoaded, getInstructionsDir, invalidate, loadUsageSnapshot, touchIndexVersion, writeEntry, removeEntry } from '../indexContext';
import { logAudit } from '../auditLog';
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { attemptManifestUpdate } from '../manifestManager';
import { migrateInstructionRecord } from '../../versioning/schemaVersion';
import { deriveCategory, slugifyCategory } from '../categoryRules';
import { hashBody as canonicalHashBody } from '../canonical';
import { InstructionEntry, PRIORITY_TIERS } from '../../models/instruction';
import { guard, computeSourceHash, normalizeCategories } from './instructions.shared';
import { validateForDisk, getSchemaPropertyNames } from '../loaderSchemaValidator';
import { sanitizeErrorDetail } from '../instructionRecordValidation';
import { migrateLegacyInstructionEntry, SchemaMigrationResult } from '../schemaMigrationService';

registerHandler('index_enrich', guard('index_enrich', () => {
  const st = ensureLoaded();
  let rewritten = 0; const updated: string[] = []; const skipped: string[] = []; const errors: { id: string; error: string }[] = [];
  for (const e of st.list) {
    // Use in-memory state as the raw record (works for both SQLite and JSON backends)
    const raw = { ...e } as unknown as Record<string, unknown>;
    try {
      let needs = false;
      const nowIso = new Date().toISOString();
      if (!(typeof raw.sourceHash === 'string' && raw.sourceHash.length > 0)) { raw.sourceHash = e.sourceHash || computeSourceHash(String(e.body || '')); needs = true; }
      if (typeof raw.createdAt === 'string' && raw.createdAt.length === 0) { raw.createdAt = e.createdAt || nowIso; needs = true; }
      if (typeof raw.updatedAt === 'string' && raw.updatedAt.length === 0) { raw.updatedAt = e.updatedAt || nowIso; needs = true; }
      if (raw.owner === 'unowned' && e.owner && e.owner !== 'unowned') { raw.owner = e.owner; needs = true; }
      if ((raw.priorityTier === undefined || raw.priorityTier === null || raw.priorityTier === '') && e.priorityTier) { raw.priorityTier = e.priorityTier; needs = true; }
      if (!(typeof raw.semanticSummary === 'string' && raw.semanticSummary.length > 0) && e.semanticSummary) { raw.semanticSummary = e.semanticSummary; needs = true; }
      const apply = (k: keyof InstructionEntry) => {
        const onDisk = raw[k];
        const norm = (e as unknown as Record<string, unknown>)[k];
        switch (k) {
          case 'sourceHash':
            if (!(typeof onDisk === 'string' && onDisk.length > 0) && typeof norm === 'string') { raw[k] = norm; needs = true; }
            break;
          case 'owner':
            if (onDisk === 'unowned' && typeof norm === 'string' && norm !== 'unowned') { raw[k] = norm; needs = true; }
            break;
          case 'updatedAt':
            if (typeof onDisk === 'string' && onDisk.length === 0 && typeof norm === 'string' && norm.length > 0) { raw[k] = norm; needs = true; }
            break;
          case 'priorityTier':
            if ((onDisk === undefined || onDisk === null || onDisk === '') && typeof norm === 'string') { raw[k] = norm; needs = true; }
            break;
          case 'semanticSummary':
            if (!(typeof onDisk === 'string' && onDisk.length > 0) && typeof norm === 'string') { raw[k] = norm; needs = true; }
            break;
          case 'contentType':
            if (!onDisk && typeof norm === 'string') { raw[k] = norm; needs = true; }
            break;
          default: break;
        }
      };
      apply('sourceHash'); apply('owner'); apply('createdAt'); apply('updatedAt'); apply('priorityTier'); apply('semanticSummary'); apply('contentType');
      if (needs) { writeEntry(raw as unknown as InstructionEntry); rewritten++; updated.push(e.id); } else { skipped.push(e.id); }
    } catch (err) {
      const detail = (err as Error).message || 'unknown';
      errors.push({ id: e.id, error: detail });
      logAudit('enrich_entry_error', e.id, { error: detail });
    }
  }
  if (rewritten) { touchIndexVersion(); invalidate(); ensureLoaded(); }
  const resp: { rewritten: number; updated: string[]; skipped: string[]; errors?: { id: string; error: string }[] } = { rewritten, updated, skipped };
  if (errors.length) resp.errors = errors;
  if (rewritten) {
    logAudit('enrich', updated, { rewritten, skipped: skipped.length, errors: errors.length });
    attemptManifestUpdate();
  }
  return resp;
}));

registerHandler('index_repair', guard('index_repair', (_p: unknown) => {
  const st = ensureLoaded(); const toFix: { entry: InstructionEntry; actual: string; originalId: string; migration?: SchemaMigrationResult }[] = [];
  for (const e of st.list) {
    const migration = migrateLegacyInstructionEntry(e as unknown as Record<string, unknown>, { source: 'index_repair' });
    const migrated = migration.entry as unknown as InstructionEntry;
    const actual = computeSourceHash(String(migrated.body || ''));
    if (migration.changed || actual !== migrated.sourceHash) toFix.push({ entry: migrated, actual, originalId: e.id, migration: migration.changed ? migration : undefined });
  }
  const repaired: string[] = []; const errors: { id: string; error: string }[] = [];
  const migrationDetails: Array<Pick<SchemaMigrationResult, 'originalId' | 'id' | 'schemaVersion' | 'changes'>> = [];
  for (const { entry, actual, originalId, migration } of toFix) {
    try {
      const updated = { ...entry, sourceHash: actual, updatedAt: new Date().toISOString() };
      writeEntry(updated as InstructionEntry);
      if (entry.id !== originalId) removeEntry(originalId);
      if (migration) {
        migrationDetails.push({
          originalId: migration.originalId,
          id: migration.id,
          schemaVersion: migration.schemaVersion,
          changes: migration.changes,
        });
      }
      repaired.push(entry.id);
    } catch (err) {
      const detail = (err as Error).message || 'unknown';
      errors.push({ id: entry.id, error: detail });
      logAudit('repair_entry_error', entry.id, { error: detail });
    }
  }

  // Repair skipped files: scan disk for .json files not in the loaded index (#207)
  const skippedRepaired: string[] = []; const skippedErrors: { id: string; error: string }[] = [];
  try {
    const dir = getInstructionsDir();
    // Exclude internal manifest (_*) and bootstrap gating state files. These
    // are runtime bookkeeping owned by bootstrapGating.ts, not instructions.
    // Without this filter they surface as 'missing required fields' noise in
    // every index_repair response. RCA 2026-05-07.
    const STATE_FILES = new Set(['bootstrap.confirmed.json', 'bootstrap.pending.json']);
    const diskFiles = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_') && !STATE_FILES.has(f));
    // Use the compiled-in schema property set so disk-resident vs static-import
    // schemas can never diverge (review #211 finding 9).
    const schemaProps = getSchemaPropertyNames();

    for (const file of diskFiles) {
      const id = file.replace(/\.json$/, '');
      if (st.byId.has(id)) continue; // already loaded, not skipped
      const filePath = path.join(dir, file);
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
        if (!raw.id || !raw.body) { skippedErrors.push({ id, error: 'missing required fields (id or body)' }); continue; }

        const keys = Object.keys(raw);
        let stripped = false;
        if (schemaProps.size) {
          for (const key of keys) {
            if (!schemaProps.has(key)) { delete raw[key]; stripped = true; }
          }
        }
        const migration = migrateLegacyInstructionEntry(raw, { source: 'index_repair' });
        const migrated = migration.entry;
        if (stripped || migration.changed) {
          migrated.sourceHash = computeSourceHash(String(migrated.body));
          migrated.updatedAt = new Date().toISOString();
          migrateInstructionRecord(migrated);
          const diskCheck = validateForDisk(migrated);
          if (!diskCheck.valid) {
            skippedErrors.push({ id, error: sanitizeErrorDetail(`schema validation failed: ${(diskCheck.errors || []).join('; ')}`) || 'schema validation failed' });
            continue;
          }
          writeEntry(migrated as unknown as InstructionEntry);
          if (typeof migrated.id === 'string' && migrated.id !== id) {
            try { removeEntry(id); } catch { /* old skipped file may already be absent in non-JSON stores */ }
          }
          if (migration.changed) {
            migrationDetails.push({
              originalId: migration.originalId,
              id: migration.id,
              schemaVersion: migration.schemaVersion,
              changes: migration.changes,
            });
          }
          skippedRepaired.push(typeof migrated.id === 'string' ? migrated.id : id);
        }
      } catch (err) {
        // Sanitize the raw error before returning to the client (review #211 finding 6).
        skippedErrors.push({ id, error: sanitizeErrorDetail((err as Error).message) || 'unknown' });
      }
    }
  } catch (err) {
    errors.push({ id: '__disk_scan__', error: sanitizeErrorDetail(`skipped-file scan failed: ${(err as Error).message || 'unknown'}`) || 'skipped-file scan failed' });
  }

  const allRepaired = [...repaired, ...skippedRepaired];
  if (allRepaired.length) { touchIndexVersion(); invalidate(); ensureLoaded(); }
  const resp: { repaired: number; updated: string[]; skippedRepaired: string[]; errors: { id: string; error: string }[]; migrationCount: number; migrationDetails: Array<Pick<SchemaMigrationResult, 'originalId' | 'id' | 'schemaVersion' | 'changes'>> } = {
    repaired: allRepaired.length, updated: repaired, skippedRepaired, errors: [...errors, ...skippedErrors], migrationCount: migrationDetails.length, migrationDetails
  };
  if (allRepaired.length) { logAudit('repair', allRepaired, { repaired: allRepaired.length, skippedRepaired: skippedRepaired.length, errors: errors.length + skippedErrors.length, migrationCount: migrationDetails.length }); attemptManifestUpdate(); }
  return resp;
}));

registerHandler('index_groom', guard('index_groom', (p: { mode?: { dryRun?: boolean; removeDeprecated?: boolean; mergeDuplicates?: boolean; purgeLegacyScopes?: boolean; remapCategories?: boolean } }) => {
  const mode = p.mode || {}; const dryRun = !!mode.dryRun; const removeDeprecated = !!mode.removeDeprecated; const mergeDuplicates = !!mode.mergeDuplicates; const purgeLegacyScopes = !!mode.purgeLegacyScopes; const remapCategories = !!mode.remapCategories; const stBefore = ensureLoaded(); const previousHash = stBefore.hash; const scanned = stBefore.list.length; let repairedHashes = 0, normalizedCategories = 0, deprecatedRemoved = 0, duplicatesMerged = 0, filesRewritten = 0, purgedScopes = 0, migrated = 0, remappedCategories = 0; const notes: string[] = []; const byId = new Map<string, InstructionEntry>(); stBefore.list.forEach(e => byId.set(e.id, { ...e })); const updated = new Set<string>();
  for (const e of byId.values()) { const migrationResult = migrateInstructionRecord(e as unknown as Record<string, unknown>); if (migrationResult.changed) { migrated++; updated.add(e.id); } }
  let signalApplied = 0;
  { const usageSnap = loadUsageSnapshot() as Record<string, { lastSignal?: string }>;
    for (const e of byId.values()) {
      const rec = usageSnap[e.id];
      if (!rec?.lastSignal) continue;
      const sig = rec.lastSignal;
      let mutated = false;
      if (sig === 'outdated') {
        if (e.requirement !== 'deprecated') { e.requirement = 'deprecated'; e.updatedAt = new Date().toISOString(); mutated = true; }
      } else if (sig === 'not-relevant') {
        const np = Math.max(30, (e.priority ?? 50) - 10);
        if (np !== e.priority) { e.priority = np; e.updatedAt = new Date().toISOString(); mutated = true; }
      } else if (sig === 'helpful') {
        const np = Math.min(100, (e.priority ?? 50) + 5);
        if (np !== e.priority) { e.priority = np; e.updatedAt = new Date().toISOString(); mutated = true; }
      } else if (sig === 'applied') {
        const np = Math.min(100, (e.priority ?? 50) + 2);
        if (np !== e.priority) { e.priority = np; e.updatedAt = new Date().toISOString(); mutated = true; }
      }
      if (mutated) { signalApplied++; updated.add(e.id); }
    }
  }
  for (const e of byId.values()) {
    const normCats = normalizeCategories(e.categories || []);
    if (JSON.stringify(normCats) !== JSON.stringify(e.categories)) { e.categories = normCats; normalizedCategories++; e.updatedAt = new Date().toISOString(); updated.add(e.id); }
  }
  const duplicateBodies = new Set<string>();
  if (mergeDuplicates) { const groups = new Map<string, InstructionEntry[]>(); for (const e of byId.values()) { const key = e.sourceHash || computeSourceHash(e.body); const arr = groups.get(key) || []; arr.push(e); groups.set(key, arr); } for (const group of groups.values()) { if (group.length <= 1) continue; let primary = group[0]; for (const candidate of group) { if (candidate.createdAt && primary.createdAt) { if (candidate.createdAt < primary.createdAt) primary = candidate; } else if (!primary.createdAt && candidate.createdAt) { primary = candidate; } else if (candidate.id < primary.id) { primary = candidate; } } for (const dup of group) { if (dup.id === primary.id) continue; if (dup.priority < primary.priority) { primary.priority = dup.priority; updated.add(primary.id); } if (typeof dup.riskScore === 'number') { if (typeof primary.riskScore !== 'number' || dup.riskScore > primary.riskScore) { primary.riskScore = dup.riskScore; updated.add(primary.id); } } const mergedCats = Array.from(new Set([...(primary.categories || []), ...(dup.categories || [])])).sort(); if (JSON.stringify(mergedCats) !== JSON.stringify(primary.categories)) { primary.categories = mergedCats; updated.add(primary.id); } if (removeDeprecated) { duplicateBodies.add(dup.id); } else { if (dup.deprecatedBy !== primary.id) { dup.deprecatedBy = primary.id; dup.requirement = 'deprecated'; dup.updatedAt = new Date().toISOString(); updated.add(dup.id); } } duplicatesMerged++; } } }
  const toRemove: string[] = []; if (removeDeprecated) { for (const e of byId.values()) { if (e.deprecatedBy && byId.has(e.deprecatedBy)) toRemove.push(e.id); } for (const id of duplicateBodies) { if (!toRemove.includes(id)) toRemove.push(id); } }
  if (purgeLegacyScopes) { for (const e of byId.values()) { try { const cats = e.categories; if (Array.isArray(cats)) { const legacyTokens = cats.filter(c => typeof c === 'string' && /^scope:(workspace|user|team):/.test(c)); if (legacyTokens.length) { purgedScopes += legacyTokens.length; updated.add(e.id); } } } catch (err) { notes.push(`purgeLegacyScopes-failed:${e.id}:${(err as Error).message || String(err)}`); } } if (dryRun && purgedScopes) notes.push(`would-purge:${purgedScopes}`); }
  if (remapCategories) { for (const e of byId.values()) { if (e.primaryCategory && e.primaryCategory !== 'uncategorized') continue; const derived = deriveCategory(e.id); if (derived === 'Other') continue; const slug = slugifyCategory(derived); if (!slug) continue; e.primaryCategory = slug; if (!e.categories.includes(slug)) { e.categories = [...e.categories, slug].sort(); } e.updatedAt = new Date().toISOString(); remappedCategories++; updated.add(e.id); } }
  { for (const e of byId.values()) { const storedHash = e.sourceHash || ''; const actualHash = computeSourceHash(e.body); if (storedHash !== actualHash) { e.sourceHash = actualHash; repairedHashes++; e.updatedAt = new Date().toISOString(); updated.add(e.id); } } }
  deprecatedRemoved = toRemove.length; const errors: { id: string; error: string }[] = []; if (!dryRun) { for (const id of toRemove) { byId.delete(id); } for (const id of updated) { if (!byId.has(id)) continue; const e = byId.get(id)!; try { writeEntry(e); filesRewritten++; } catch (err) { const detail = (err as Error).message || String(err); errors.push({ id, error: `write-failed: ${detail}` }); notes.push(`write-failed:${id}:${detail}`); logAudit('groom_entry_error', id, { error: detail, operation: 'write' }); } } for (const id of toRemove) { try { removeEntry(id); } catch (err) { const detail = (err as Error).message || String(err); errors.push({ id, error: `delete-failed: ${detail}` }); notes.push(`delete-failed:${id}:${detail}`); logAudit('groom_entry_error', id, { error: detail, operation: 'delete' }); } } if (updated.size || toRemove.length) { touchIndexVersion(); invalidate(); ensureLoaded(); } } else { if (updated.size) notes.push(`would-rewrite:${updated.size}`); if (toRemove.length) notes.push(`would-remove:${toRemove.length}`); }
  const stAfter = ensureLoaded(); const resp: Record<string, unknown> = { previousHash, hash: stAfter.hash, scanned, repairedHashes, normalizedCategories, deprecatedRemoved, duplicatesMerged, signalApplied, filesRewritten, purgedScopes, migrated, remappedCategories, dryRun, notes }; if (errors.length) resp.errors = errors; if (!dryRun && (repairedHashes || normalizedCategories || deprecatedRemoved || duplicatesMerged || signalApplied || filesRewritten || purgedScopes || migrated || remappedCategories)) { logAudit('groom', undefined, { repairedHashes, normalizedCategories, deprecatedRemoved, duplicatesMerged, signalApplied, filesRewritten, purgedScopes, migrated, remappedCategories, errors: errors.length }); attemptManifestUpdate(); } return resp;
}));

registerHandler('index_normalize', guard('index_normalize', (p: { dryRun?: boolean; forceCanonical?: boolean }) => {
  const dryRun = !!p?.dryRun;
  const forceCanonical = !!p?.forceCanonical;
  const instructionsCfg = getRuntimeConfig().instructions;
  const base = getInstructionsDir();
  const dirs = [base, path.join(process.cwd(), 'devinstructions')].filter(d => { try { fs.accessSync(d); return true; } catch { return false; } });
  let scanned = 0, changed = 0, fixedHash = 0, fixedVersion = 0, fixedTier = 0, addedTimestamps = 0, addedContentType = 0; const updatedIds: string[] = []; const errors: { id: string; error: string }[] = [];
  const scannedIds = new Set<string>();
  const SEMVER = /^\d+\.\d+\.\d+(?:[-+].*)?$/;
  for (const dir of dirs) {
    let files: string[] = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_')); } catch { continue; }
    for (const f of files) {
      scanned++;
      const full = path.join(dir, f);
      let raw: string; try { raw = fs.readFileSync(full, 'utf8'); } catch { continue; }
      let data: unknown; try { data = JSON.parse(raw); } catch { continue; }
      if (!data || typeof data !== 'object') continue;
      let modified = false;
      const rec = data as Record<string, unknown>;
      if (typeof rec.id === 'string') scannedIds.add(rec.id);
      const body = typeof rec.body === 'string' ? rec.body : '';
      if (body) {
        const useCanonical = forceCanonical || !instructionsCfg.canonicalDisable;
        const actual = useCanonical ? canonicalHashBody(body) : crypto.createHash('sha256').update(body, 'utf8').digest('hex');
        if (rec.sourceHash !== actual) { rec.sourceHash = actual; modified = true; fixedHash++; }
      }
      if (!rec.contentType || typeof rec.contentType !== 'string' || rec.contentType.length === 0) { rec.contentType = 'instruction'; modified = true; addedContentType++; }
      if (!rec.version || typeof rec.version !== 'string' || !SEMVER.test(rec.version)) { rec.version = '1.0.0'; modified = true; fixedVersion++; }
      if (rec.priorityTier) {
        const upper = String(rec.priorityTier).toUpperCase();
        if ((PRIORITY_TIERS as readonly string[]).includes(upper) && upper !== rec.priorityTier) { rec.priorityTier = upper; modified = true; fixedTier++; }
      }
      const nowIso = new Date().toISOString();
      if (!rec.createdAt) { rec.createdAt = nowIso; modified = true; addedTimestamps++; }
      if (!rec.updatedAt) { rec.updatedAt = nowIso; modified = true; addedTimestamps++; }
      if (modified) {
        if (!dryRun) { try { writeEntry(rec as unknown as InstructionEntry); } catch (err) { errors.push({ id: path.basename(full, '.json'), error: `write-failed: ${(err as Error).message || String(err)}` }); continue; } }
        changed++; updatedIds.push(path.basename(full, '.json'));
      }
    }
  }
  // Store fallback: process entries from in-memory store not already scanned from disk
  {
    const stNorm = ensureLoaded();
    for (const entry of stNorm.list) {
      if (scannedIds.has(entry.id)) continue;
      scanned++;
      let modified = false;
      const rec = { ...entry } as Record<string, unknown>;
      const body = typeof rec.body === 'string' ? rec.body : '';
      if (body) {
        const useCanonical = forceCanonical || !instructionsCfg.canonicalDisable;
        const actual = useCanonical ? canonicalHashBody(body) : crypto.createHash('sha256').update(body, 'utf8').digest('hex');
        if (rec.sourceHash !== actual) { rec.sourceHash = actual; modified = true; fixedHash++; }
      }
      if (!rec.contentType || typeof rec.contentType !== 'string' || (rec.contentType as string).length === 0) { rec.contentType = 'instruction'; modified = true; addedContentType++; }
      if (!rec.version || typeof rec.version !== 'string' || !SEMVER.test(rec.version as string)) { rec.version = '1.0.0'; modified = true; fixedVersion++; }
      if (rec.priorityTier) {
        const upper = String(rec.priorityTier).toUpperCase();
        if ((PRIORITY_TIERS as readonly string[]).includes(upper) && upper !== rec.priorityTier) { rec.priorityTier = upper; modified = true; fixedTier++; }
      }
      const nowIso = new Date().toISOString();
      if (!rec.createdAt) { rec.createdAt = nowIso; modified = true; addedTimestamps++; }
      if (!rec.updatedAt) { rec.updatedAt = nowIso; modified = true; addedTimestamps++; }
      if (modified) {
        if (!dryRun) { try { writeEntry(rec as unknown as InstructionEntry); } catch (err) { errors.push({ id: entry.id, error: `write-failed: ${(err as Error).message || String(err)}` }); continue; } }
        changed++; updatedIds.push(entry.id);
      }
    }
  }
  if (changed && !dryRun) {
    try { touchIndexVersion(); invalidate(); ensureLoaded(); } catch (err) { logAudit('normalize_reload_error', undefined, { error: (err as Error).message }); }
    try { attemptManifestUpdate(); } catch (err) { logAudit('normalize_manifest_error', undefined, { error: (err as Error).message }); }
  }
  const normalizeResp: Record<string, unknown> = { scanned, changed, fixedHash, fixedVersion, fixedTier, addedTimestamps, addedContentType, dryRun, updated: updatedIds };
  if (errors.length) normalizeResp.errors = errors;
  return normalizeResp;
}));

// usage_flush (mutation)
registerHandler('usage_flush', guard('usage_flush', () => ({ flushed: true })));

export {};
