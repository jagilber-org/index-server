import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { InstructionEntry } from '../../models/instruction';
import { registerHandler } from '../../server/registry';
import { ensureLoadedAsync, getInstructionsDir, invalidate, touchIndexVersion, writeEntryAsync } from '../indexContext';
import { incrementCounter } from '../features';
import { SCHEMA_VERSION } from '../../versioning/schemaVersion';
import { ClassificationService } from '../classificationService';
import { resolveOwner } from '../ownershipService';
import { validateInstructionInputSurface, validateInstructionRecord } from '../instructionRecordValidation';
import { isInstructionValidationError } from '../instructionRecordValidation';

import { logAudit } from '../auditLog';
import { logInfo, logError, log } from '../logger';

// Structured WARN without auto-attached call stack: the log-hygiene gate
// (scripts/crawl-logs.mjs) treats WARN-with-stack as a budget violation
// (max-stack-warn=5). Use log('WARN', ...) directly with serialized detail
// so per-entry import rejections stay structured but stackless.
const warnStruct = (msg: string, detail?: unknown) =>
  log('WARN', msg, { detail: detail === undefined ? undefined : typeof detail === 'string' ? detail : JSON.stringify(detail) });
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { attemptManifestUpdate } from '../manifestManager';
import { guard, ImportEntry, normalizeInputCategories, IMPORT_GOVERNANCE_KEYS, applyGovernanceKeys } from './instructions.shared';

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

registerHandler('index_import', guard('index_import', async (p: { entries?: ImportEntry[] | string; source?: string; mode?: 'skip' | 'overwrite' }) => {
  let entries: ImportEntry[];
  const mode = p.mode || 'skip';
  // Source-type breadcrumb for observability: agents currently get a silent
  // { error: ... } back on top-level failures (path-blocked, parse errors,
  // missing files). Without these explicit WARN logs the only signal is the
  // RPC response, which dashboards/tails never see (RCA 2026-05-01 dev 8687).
  const sourceType = Array.isArray(p.entries)
    ? 'inline-array'
    : typeof p.entries === 'string'
      ? 'inline-or-file'
      : typeof p.source === 'string'
        ? 'directory'
        : 'none';
  const inlineCount = Array.isArray(p.entries) ? p.entries.length : undefined;
  logInfo('[import] start', { mode, sourceType, inlineCount, source: typeof p.source === 'string' ? p.source : undefined });
  if (Array.isArray(p.entries)) {
    entries = p.entries;
  } else if (typeof p.entries === 'string') {
    const inlineEntries = parseInlineEntries(p.entries);
    if (inlineEntries.error) { warnStruct('[import] rejected', { reason: 'inline-parse-error', detail: inlineEntries.error }); return inlineEntries.error; }
    if (inlineEntries.entries) {
      entries = inlineEntries.entries;
    } else {
      const filePath = path.resolve(p.entries);
      if (!isPathAllowed(filePath)) { warnStruct('[import] rejected', { reason: 'path-not-allowed', path: filePath }); return { error: 'entries path is outside allowed directories', path: filePath }; }
      if (!fs.existsSync(filePath)) { warnStruct('[import] rejected', { reason: 'entries-file-not-found', path: filePath }); return { error: 'entries file not found', path: filePath }; }
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!Array.isArray(raw)) { warnStruct('[import] rejected', { reason: 'entries-file-not-array', path: filePath }); return { error: 'entries file must contain a JSON array', path: filePath }; }
        entries = raw as ImportEntry[];
      } catch (e) { warnStruct('[import] rejected', { reason: 'entries-file-parse-error', path: filePath, detail: (e as Error).message }); return { error: 'entries file parse error', path: filePath, detail: (e as Error).message }; }
    }
  } else if (typeof p.source === 'string') {
    const dirPath = path.resolve(p.source);
    if (!isPathAllowed(dirPath)) { warnStruct('[import] rejected', { reason: 'source-not-allowed', path: dirPath }); return { error: 'source path is outside allowed directories', path: dirPath }; }
    if (!fs.existsSync(dirPath)) { warnStruct('[import] rejected', { reason: 'source-not-found', path: dirPath }); return { error: 'source directory not found', path: dirPath }; }
    let stat: fs.Stats;
    try { stat = fs.statSync(dirPath); } catch (e) { warnStruct('[import] rejected', { reason: 'source-inaccessible', path: dirPath, detail: (e as Error).message }); return { error: 'source path inaccessible', path: dirPath, detail: (e as Error).message }; }
    if (!stat.isDirectory()) { warnStruct('[import] rejected', { reason: 'source-not-directory', path: dirPath }); return { error: 'source path is not a directory', path: dirPath }; }
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json') && !f.startsWith('_'));
    entries = [];
    for (const fname of files) {
      const fpath = path.join(dirPath, fname);
      try {
        const parsed = JSON.parse(fs.readFileSync(fpath, 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.id) entries.push(parsed as ImportEntry);
      } catch (e) { warnStruct('[import] file skipped (parse error)', { file: fname, detail: (e as Error).message }); }
    }
  } else {
    entries = [];
  }
  if (!entries.length) { warnStruct('[import] rejected', { reason: 'no-entries' }); return { error: 'no entries' }; }
  const dir = getInstructionsDir(); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const instructionsCfg = getRuntimeConfig().instructions;
  let imported = 0, skipped = 0, overwritten = 0; const errors: { id: string; error: string }[] = []; const classifier = new ClassificationService();
  const skippedIds = new Set<string>();
  const formatImportValidationError = (validationErrors: string[]) => `invalid_instruction: ${validationErrors.join('; ')}`;
  for (const e of entries) {
    const id = (e as Partial<ImportEntry>)?.id || 'unknown';
    const requiredFieldErrors = [
      !e?.id ? 'id: missing required field' : undefined,
      e?.title === undefined ? 'title: missing required field' : undefined,
      e?.body === undefined ? 'body: missing required field' : undefined,
      e?.priority === undefined ? 'priority: missing required field' : undefined,
      e?.audience === undefined ? 'audience: missing required field' : undefined,
      e?.requirement === undefined ? 'requirement: missing required field' : undefined,
    ].filter((issue): issue is string => !!issue);
    const surfaceValidation = e ? validateInstructionInputSurface(e as unknown as Record<string, unknown>) : { validationErrors: [], hints: [], schemaRef: 'index_add#input' };
    if (!e || requiredFieldErrors.length || surfaceValidation.validationErrors.length) {
      const errMsg = formatImportValidationError([...requiredFieldErrors, ...surfaceValidation.validationErrors]);
      errors.push({ id, error: errMsg });
      warnStruct('[import] entry rejected', { id, reason: 'invalid-input', error: errMsg });
      continue;
    }
    const bodyTrimmed = typeof e.body === 'string' ? e.body.trim() : String(e.body);
    const { bodyWarnLength: importBodyMax } = getRuntimeConfig().index;
    if (bodyTrimmed.length > importBodyMax) {
      errors.push({ id: e.id, error: `body_too_large: ${bodyTrimmed.length} chars exceeds ${importBodyMax} limit. Split into cross-linked instructions.` });
      warnStruct('[import] entry rejected', { id: e.id, reason: 'body-too-large', length: bodyTrimmed.length, limit: importBodyMax });
      continue;
    }
    const file = path.join(dir, `${e.id}.json`);
    const stImport = await ensureLoadedAsync();
    const storeHas = stImport.byId.has(e.id);
    const fileExists = storeHas || fs.existsSync(file);
    const now = new Date().toISOString();
    let categories = normalizeInputCategories(e.categories);
    const primaryCategoryRaw = (e as unknown as Record<string, unknown>).primaryCategory as string | undefined;
    if (!categories.length) {
      if (instructionsCfg.requireCategory) { errors.push({ id: e.id, error: 'category_required' }); warnStruct('[import] entry rejected', { id: e.id, reason: 'category-required' }); continue; }
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
    if (e.priorityTier === 'P1' && (!categories.length || !e.owner)) { errors.push({ id: e.id, error: 'P1 requires category & owner' }); warnStruct('[import] entry rejected', { id: e.id, reason: 'p1-requires-category-and-owner' }); continue; }
    if ((e.requirement === 'mandatory' || e.requirement === 'critical') && !e.owner) { errors.push({ id: e.id, error: 'mandatory/critical require owner' }); warnStruct('[import] entry rejected', { id: e.id, reason: 'mandatory-critical-require-owner', requirement: e.requirement }); continue; }
    if (fileExists && mode === 'skip') { skipped++; skippedIds.add(e.id); continue; }
    const base: InstructionEntry = existing ? { ...existing, title: e.title, body: bodyTrimmed, rationale: e.rationale, priority: e.priority, audience: e.audience, requirement: e.requirement, categories, primaryCategory: effectivePrimary, updatedAt: now } as InstructionEntry : { id: e.id, title: e.title, body: bodyTrimmed, rationale: e.rationale, priority: e.priority, audience: e.audience, requirement: e.requirement, categories, primaryCategory: effectivePrimary, sourceHash: newBodyHash, schemaVersion: SCHEMA_VERSION, deprecatedBy: e.deprecatedBy, createdAt: now, updatedAt: now, riskScore: e.riskScore, createdByAgent: instructionsCfg.agentId, sourceWorkspace: instructionsCfg.workspaceId, extensions: e.extensions } as InstructionEntry;
    applyGovernanceKeys(base, e, IMPORT_GOVERNANCE_KEYS);
    if (!base.sourceWorkspace) base.sourceWorkspace = instructionsCfg.workspaceId;
    base.sourceHash = newBodyHash;
    const record = classifier.normalize(base);
    if (record.owner === 'unowned') { const auto = resolveOwner(record.id); if (auto) { record.owner = auto; record.updatedAt = new Date().toISOString(); } }
    const recordValidation = validateInstructionRecord(record);
    if (recordValidation.validationErrors.length) {
      const errMsg = formatImportValidationError(recordValidation.validationErrors);
      errors.push({ id: e.id, error: errMsg });
      warnStruct('[import] entry rejected', { id: e.id, reason: 'record-validation-failed', error: errMsg });
      continue;
    }
     try { await writeEntryAsync(record); } catch (err) {
      if (isInstructionValidationError(err)) {
        const errMsg = formatImportValidationError(err.validationErrors);
        errors.push({ id: e.id, error: errMsg });
        logError('[import] entry write rejected', { id: e.id, reason: 'validation-failed-at-write', error: errMsg });
        continue;
      }
      const writeMsg = (err as Error).message || 'unknown';
      errors.push({ id: e.id, error: `write-failed: ${writeMsg}` });
      logError('[import] entry write failed', { id: e.id, error: writeMsg, stack: (err as Error).stack });
      continue;
    }
    if (fileExists && mode === 'overwrite') overwritten++; else if (!fileExists) imported++;
  }
  touchIndexVersion(); invalidate(); const st = await ensureLoadedAsync();
  // Read-back verification: confirm each written entry is visible in the reloaded index
  const verificationErrors: { id: string; error: string }[] = [];
  const writtenIds = entries
    .filter(e => e.id && !errors.some(err => err.id === e.id) && !skippedIds.has(e.id))
    .map(e => e.id);
  for (const id of writtenIds) {
    if (!st.byId.has(id)) {
      verificationErrors.push({ id, error: 'not-in-index-after-reload' });
    }
  }
  if (verificationErrors.length) {
    errors.push(...verificationErrors);
    logAudit('import_verification', verificationErrors.map(v => v.id), { missingAfterReload: verificationErrors.length });
    logError('[import] verification failed', { missingAfterReload: verificationErrors.length, ids: verificationErrors.map(v => v.id) });
  }
  const verifiedCount = writtenIds.length - verificationErrors.length;
  const summary = { hash: st.hash, imported, skipped, overwritten, total: entries.length, errors, verified: verificationErrors.length === 0, verifiedCount, verificationErrorCount: verificationErrors.length };
  logAudit('import', entries.map(e => e.id), { imported, skipped, overwritten, errors: errors.length, verified: verificationErrors.length === 0 });
  if (errors.length) {
    warnStruct('[import] complete with errors', { imported, skipped, overwritten, total: entries.length, errorCount: errors.length, verifiedCount, verificationErrorCount: verificationErrors.length, errorIds: errors.map(e => e.id) });
  } else {
    logInfo('[import] complete', { imported, skipped, overwritten, total: entries.length, verifiedCount });
  }
  attemptManifestUpdate();
  return summary;
}));

export {};
