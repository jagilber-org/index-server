import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { InstructionEntry } from '../../models/instruction';
import { registerHandler } from '../../server/registry';
import { ensureLoaded, getInstructionsDir, invalidate, touchIndexVersion, writeEntry } from '../indexContext';
import { incrementCounter } from '../features';
import { SCHEMA_VERSION } from '../../versioning/schemaVersion';
import { ClassificationService } from '../classificationService';
import { resolveOwner } from '../ownershipService';
import { atomicWriteJson } from '../atomicFs';
import { logAudit } from '../auditLog';
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { attemptManifestUpdate } from '../manifestManager';
import { guard, ImportEntry } from './instructions.shared';

/** Validate that a resolved path falls within allowed base directories (cwd or configured data dir). */
function isPathAllowed(resolved: string): boolean {
  const cwd = process.cwd();
  const config = getRuntimeConfig();
  const dataDir = config.index.baseDir || cwd;
  const normalizedResolved = path.resolve(resolved);
  const allowedRoots = [path.resolve(cwd), path.resolve(dataDir)];
  return allowedRoots.some(root => normalizedResolved.startsWith(root + path.sep) || normalizedResolved === root);
}

function parseInlineEntries(rawEntries: string): { entries?: ImportEntry[]; error?: { error: string; detail?: string } } {
  const trimmed = rawEntries.trim();
  if (!(trimmed.startsWith('[') && trimmed.endsWith(']'))) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return { error: { error: 'entries JSON must contain an array' } };
    return { entries: parsed as ImportEntry[] };
  } catch (e) {
    return { error: { error: 'entries JSON parse error', detail: (e as Error).message } };
  }
}

registerHandler('index_import', guard('index_import', (p: { entries?: ImportEntry[] | string; source?: string; mode?: 'skip' | 'overwrite' }) => {
  let entries: ImportEntry[];
  const mode = p.mode || 'skip';
  if (Array.isArray(p.entries)) {
    entries = p.entries;
  } else if (typeof p.entries === 'string') {
    const inlineEntries = parseInlineEntries(p.entries);
    if (inlineEntries.error) return inlineEntries.error;
    if (inlineEntries.entries) {
      entries = inlineEntries.entries;
    } else {
      const filePath = path.resolve(p.entries);
      if (!isPathAllowed(filePath)) return { error: 'entries path is outside allowed directories', path: filePath };
      if (!fs.existsSync(filePath)) return { error: 'entries file not found', path: filePath };
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!Array.isArray(raw)) return { error: 'entries file must contain a JSON array', path: filePath };
        entries = raw as ImportEntry[];
      } catch (e) { return { error: 'entries file parse error', path: filePath, detail: (e as Error).message }; }
    }
  } else if (typeof p.source === 'string') {
    const dirPath = path.resolve(p.source);
    if (!isPathAllowed(dirPath)) return { error: 'source path is outside allowed directories', path: dirPath };
    if (!fs.existsSync(dirPath)) return { error: 'source directory not found', path: dirPath };
    let stat: fs.Stats;
    try { stat = fs.statSync(dirPath); } catch (e) { return { error: 'source path inaccessible', path: dirPath, detail: (e as Error).message }; }
    if (!stat.isDirectory()) return { error: 'source path is not a directory', path: dirPath };
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json') && !f.startsWith('_'));
    entries = [];
    for (const fname of files) {
      const fpath = path.join(dirPath, fname);
      try {
        const parsed = JSON.parse(fs.readFileSync(fpath, 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.id) entries.push(parsed as ImportEntry);
      } catch { /* skip unparseable files */ }
    }
  } else {
    entries = [];
  }
  if (!entries.length) return { error: 'no entries' };
  const dir = getInstructionsDir(); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const instructionsCfg = getRuntimeConfig().instructions;
  let imported = 0, skipped = 0, overwritten = 0; const errors: { id: string; error: string }[] = []; const classifier = new ClassificationService();
  for (const e of entries) {
    if (!e || !e.id || !e.title || !e.body) { const id = (e as Partial<ImportEntry>)?.id || 'unknown'; errors.push({ id, error: 'missing required fields' }); continue; }
    const bodyTrimmed = typeof e.body === 'string' ? e.body.trim() : String(e.body);
    const { bodyMaxLength: importBodyMax } = getRuntimeConfig().index;
    if (bodyTrimmed.length > importBodyMax) {
      errors.push({ id: e.id, error: `body_too_large: ${bodyTrimmed.length} chars exceeds ${importBodyMax} limit. Split into cross-linked instructions.` });
      continue;
    }
    const file = path.join(dir, `${e.id}.json`);
    const stImport = ensureLoaded();
    const storeHas = stImport.byId.has(e.id);
    const fileExists = storeHas || fs.existsSync(file);
    const now = new Date().toISOString();
    let categories = Array.from(new Set((Array.isArray(e.categories) ? e.categories : []).filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map(c => c.toLowerCase()))).sort();
    const primaryCategoryRaw = (e as unknown as Record<string, unknown>).primaryCategory as string | undefined;
    if (!categories.length) {
      if (instructionsCfg.requireCategory) { errors.push({ id: e.id, error: 'category_required' }); continue; }
      categories = ['uncategorized'];
      incrementCounter('instructions:autoCategory');
    }
    const effectivePrimary = (primaryCategoryRaw && categories.includes(primaryCategoryRaw.toLowerCase())) ? primaryCategoryRaw.toLowerCase() : categories[0];
    const newBodyHash = crypto.createHash('sha256').update(bodyTrimmed, 'utf8').digest('hex');
    let existing: InstructionEntry | null = null;
    if (fileExists) {
      // Try store first (covers SQLite), fall back to disk
      const memEntry = stImport.byId.get(e.id);
      if (memEntry) { existing = { ...memEntry }; }
      else { try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { existing = null; } }
    }
    if (e.priorityTier === 'P1' && (!categories.length || !e.owner)) { errors.push({ id: e.id, error: 'P1 requires category & owner' }); continue; }
    if ((e.requirement === 'mandatory' || e.requirement === 'critical') && !e.owner) { errors.push({ id: e.id, error: 'mandatory/critical require owner' }); continue; }
    if (fileExists && mode === 'skip') { skipped++; continue; }
    if (fileExists && mode === 'overwrite') overwritten++; else if (!fileExists) imported++;
    const base: InstructionEntry = existing ? { ...existing, title: e.title, body: bodyTrimmed, rationale: e.rationale, priority: e.priority, audience: e.audience, requirement: e.requirement, categories, primaryCategory: effectivePrimary, updatedAt: now } as InstructionEntry : { id: e.id, title: e.title, body: bodyTrimmed, rationale: e.rationale, priority: e.priority, audience: e.audience, requirement: e.requirement, categories, primaryCategory: effectivePrimary, sourceHash: newBodyHash, schemaVersion: SCHEMA_VERSION, deprecatedBy: e.deprecatedBy, createdAt: now, updatedAt: now, riskScore: e.riskScore, createdByAgent: instructionsCfg.agentId, sourceWorkspace: instructionsCfg.workspaceId } as InstructionEntry;
    const govKeys: (keyof ImportEntry)[] = ['version', 'owner', 'status', 'priorityTier', 'classification', 'lastReviewedAt', 'nextReviewDue', 'changeLog', 'semanticSummary', 'contentType'];
    for (const k of govKeys) { const v = e[k]; if (v !== undefined) { (base as unknown as Record<string, unknown>)[k] = v as unknown; } }
    base.sourceHash = newBodyHash;
    const record = classifier.normalize(base);
    if (record.owner === 'unowned') { const auto = resolveOwner(record.id); if (auto) { record.owner = auto; record.updatedAt = new Date().toISOString(); } }
    try { writeEntry(record); } catch { errors.push({ id: e.id, error: 'write-failed' }); }
  }
  touchIndexVersion(); invalidate(); const st = ensureLoaded();
  const summary = { hash: st.hash, imported, skipped, overwritten, total: entries.length, errors };
  logAudit('import', entries.map(e => e.id), { imported, skipped, overwritten, errors: errors.length });
  attemptManifestUpdate();
  return summary;
}));

export {};
