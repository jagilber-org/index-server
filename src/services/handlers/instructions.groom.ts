import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { registerHandler } from '../../server/registry';
import { ensureLoaded, getInstructionsDir, invalidate, loadUsageSnapshot, touchIndexVersion, writeEntry, removeEntry } from '../indexContext';
import { logAudit } from '../auditLog';
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { attemptManifestUpdate } from '../manifestManager';
import { migrateInstructionRecord } from '../../versioning/schemaVersion';
import { deriveCategory } from '../categoryRules';
import { hashBody as canonicalHashBody } from '../canonical';
import { InstructionEntry } from '../../models/instruction';
import { guard } from './instructions.shared';

registerHandler('index_enrich', guard('index_enrich', () => {
  const st = ensureLoaded();
  let rewritten = 0; const updated: string[] = []; const skipped: string[] = [];
  for (const e of st.list) {
    // Use in-memory state as the raw record (works for both SQLite and JSON backends)
    const raw = { ...e } as unknown as Record<string, unknown>;
    try {
      let needs = false;
      const nowIso = new Date().toISOString();
      if (!(typeof raw.sourceHash === 'string' && raw.sourceHash.length > 0)) { raw.sourceHash = e.sourceHash || crypto.createHash('sha256').update(String(e.body || ''), 'utf8').digest('hex'); needs = true; }
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
    } catch { /* ignore */ }
  }
  if (rewritten) { touchIndexVersion(); invalidate(); ensureLoaded(); }
  const resp = { rewritten, updated, skipped };
  if (rewritten) {
    logAudit('enrich', updated, { rewritten, skipped: skipped.length });
    attemptManifestUpdate();
  }
  return resp;
}));

registerHandler('index_repair', guard('index_repair', (_p: unknown) => {
  const st = ensureLoaded(); const toFix: { entry: InstructionEntry; actual: string }[] = [];
  for (const e of st.list) { const actual = crypto.createHash('sha256').update(e.body, 'utf8').digest('hex'); if (actual !== e.sourceHash) toFix.push({ entry: e, actual }); }
  if (!toFix.length) return { repaired: 0, updated: [] };
  const repaired: string[] = [];
  for (const { entry, actual } of toFix) {
    try { const updated = { ...entry, sourceHash: actual, updatedAt: new Date().toISOString() }; writeEntry(updated as InstructionEntry); repaired.push(entry.id); } catch { /* ignore */ }
  }
  if (repaired.length) { touchIndexVersion(); invalidate(); ensureLoaded(); }
  const resp = { repaired: repaired.length, updated: repaired };
  if (repaired.length) { logAudit('repair', repaired, { repaired: repaired.length }); attemptManifestUpdate(); }
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
  const isJunkCategory = (cat: string): boolean => /^\d/.test(cat) || cat.length <= 1 || /^case-\d{6,}$/.test(cat);
  for (const e of byId.values()) {
    let normCats = Array.from(new Set((e.categories || []).filter(c => typeof c === 'string').map(c => c.toLowerCase())));
    normCats = normCats.filter(c => !isJunkCategory(c));
    normCats = normCats.filter(cat => !(cat.endsWith('s') && normCats.includes(cat.slice(0, -1))));
    normCats = normCats.sort();
    if (JSON.stringify(normCats) !== JSON.stringify(e.categories)) { e.categories = normCats; normalizedCategories++; e.updatedAt = new Date().toISOString(); updated.add(e.id); }
  }
  const duplicateBodies = new Set<string>();
  if (mergeDuplicates) { const groups = new Map<string, InstructionEntry[]>(); for (const e of byId.values()) { const key = e.sourceHash || crypto.createHash('sha256').update(e.body, 'utf8').digest('hex'); const arr = groups.get(key) || []; arr.push(e); groups.set(key, arr); } for (const group of groups.values()) { if (group.length <= 1) continue; let primary = group[0]; for (const candidate of group) { if (candidate.createdAt && primary.createdAt) { if (candidate.createdAt < primary.createdAt) primary = candidate; } else if (!primary.createdAt && candidate.createdAt) { primary = candidate; } else if (candidate.id < primary.id) { primary = candidate; } } for (const dup of group) { if (dup.id === primary.id) continue; if (dup.priority < primary.priority) { primary.priority = dup.priority; updated.add(primary.id); } if (typeof dup.riskScore === 'number') { if (typeof primary.riskScore !== 'number' || dup.riskScore > primary.riskScore) { primary.riskScore = dup.riskScore; updated.add(primary.id); } } const mergedCats = Array.from(new Set([...(primary.categories || []), ...(dup.categories || [])])).sort(); if (JSON.stringify(mergedCats) !== JSON.stringify(primary.categories)) { primary.categories = mergedCats; updated.add(primary.id); } if (removeDeprecated) { duplicateBodies.add(dup.id); } else { if (dup.deprecatedBy !== primary.id) { dup.deprecatedBy = primary.id; dup.requirement = 'deprecated'; dup.updatedAt = new Date().toISOString(); updated.add(dup.id); } } duplicatesMerged++; } } }
  const toRemove: string[] = []; if (removeDeprecated) { for (const e of byId.values()) { if (e.deprecatedBy && byId.has(e.deprecatedBy)) toRemove.push(e.id); } for (const id of duplicateBodies) { if (!toRemove.includes(id)) toRemove.push(id); } }
  if (purgeLegacyScopes) { for (const e of byId.values()) { try { const cats = e.categories; if (Array.isArray(cats)) { const legacyTokens = cats.filter(c => typeof c === 'string' && /^scope:(workspace|user|team):/.test(c)); if (legacyTokens.length) { purgedScopes += legacyTokens.length; updated.add(e.id); } } } catch { /* ignore */ } } if (dryRun && purgedScopes) notes.push(`would-purge:${purgedScopes}`); }
  if (remapCategories) { for (const e of byId.values()) { if (e.primaryCategory && e.primaryCategory !== 'uncategorized') continue; const derived = deriveCategory(e.id); if (derived === 'Other') continue; e.primaryCategory = derived.toLowerCase(); const lc = derived.toLowerCase(); if (!e.categories.includes(lc)) { e.categories = [...e.categories, lc].sort(); } e.updatedAt = new Date().toISOString(); remappedCategories++; updated.add(e.id); } }
  { for (const e of byId.values()) { const storedHash = e.sourceHash || ''; const actualHash = crypto.createHash('sha256').update(e.body, 'utf8').digest('hex'); if (storedHash !== actualHash) { e.sourceHash = actualHash; repairedHashes++; e.updatedAt = new Date().toISOString(); updated.add(e.id); } } }
  deprecatedRemoved = toRemove.length; if (!dryRun) { for (const id of toRemove) { byId.delete(id); } for (const id of updated) { if (!byId.has(id)) continue; const e = byId.get(id)!; try { writeEntry(e); filesRewritten++; } catch (err) { notes.push(`write-failed:${id}:${(err as Error).message}`); } } for (const id of toRemove) { try { removeEntry(id); } catch (err) { notes.push(`delete-failed:${id}:${(err as Error).message}`); } } if (updated.size || toRemove.length) { touchIndexVersion(); invalidate(); ensureLoaded(); } } else { if (updated.size) notes.push(`would-rewrite:${updated.size}`); if (toRemove.length) notes.push(`would-remove:${toRemove.length}`); }
  const stAfter = ensureLoaded(); const resp = { previousHash, hash: stAfter.hash, scanned, repairedHashes, normalizedCategories, deprecatedRemoved, duplicatesMerged, signalApplied, filesRewritten, purgedScopes, migrated, remappedCategories, dryRun, notes }; if (!dryRun && (repairedHashes || normalizedCategories || deprecatedRemoved || duplicatesMerged || signalApplied || filesRewritten || purgedScopes || migrated || remappedCategories)) { logAudit('groom', undefined, { repairedHashes, normalizedCategories, deprecatedRemoved, duplicatesMerged, signalApplied, filesRewritten, purgedScopes, migrated, remappedCategories }); attemptManifestUpdate(); } return resp;
}));

registerHandler('index_normalize', guard('index_normalize', (p: { dryRun?: boolean; forceCanonical?: boolean }) => {
  const dryRun = !!p?.dryRun;
  const forceCanonical = !!p?.forceCanonical;
  const instructionsCfg = getRuntimeConfig().instructions;
  const base = getInstructionsDir();
  const dirs = [base, path.join(process.cwd(), 'devinstructions')].filter(d => fs.existsSync(d));
  let scanned = 0, changed = 0, fixedHash = 0, fixedVersion = 0, fixedTier = 0, addedTimestamps = 0, addedContentType = 0; const updatedIds: string[] = [];
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
        if (['P1', 'P2', 'P3', 'P4'].includes(upper) && upper !== rec.priorityTier) { rec.priorityTier = upper; modified = true; fixedTier++; }
      }
      const nowIso = new Date().toISOString();
      if (!rec.createdAt) { rec.createdAt = nowIso; modified = true; addedTimestamps++; }
      if (!rec.updatedAt) { rec.updatedAt = nowIso; modified = true; addedTimestamps++; }
      if (modified) {
        if (!dryRun) { try { writeEntry(rec as unknown as InstructionEntry); } catch { continue; } }
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
        if (['P1', 'P2', 'P3', 'P4'].includes(upper) && upper !== rec.priorityTier) { rec.priorityTier = upper; modified = true; fixedTier++; }
      }
      const nowIso = new Date().toISOString();
      if (!rec.createdAt) { rec.createdAt = nowIso; modified = true; addedTimestamps++; }
      if (!rec.updatedAt) { rec.updatedAt = nowIso; modified = true; addedTimestamps++; }
      if (modified) {
        if (!dryRun) { try { writeEntry(rec as unknown as InstructionEntry); } catch { continue; } }
        changed++; updatedIds.push(entry.id);
      }
    }
  }
  if (changed && !dryRun) {
    try { touchIndexVersion(); invalidate(); ensureLoaded(); } catch { /* ignore */ }
    try { attemptManifestUpdate(); } catch { /* ignore */ }
  }
  return { scanned, changed, fixedHash, fixedVersion, fixedTier, addedTimestamps, addedContentType, dryRun, updated: updatedIds };
}));

// usage_flush (mutation)
registerHandler('usage_flush', guard('usage_flush', () => ({ flushed: true })));

export {};
