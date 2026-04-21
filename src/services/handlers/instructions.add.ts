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
import { logAudit } from '../auditLog';
import { getToolRegistry } from '../toolRegistry';
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { hashBody } from '../canonical';
import { writeManifestFromIndex, attemptManifestUpdate } from '../manifestManager';
import { emitTrace } from '../tracing';
import { guard, ImportEntry, traceVisibility, traceInstructionVisibility, traceEnvSnapshot } from './instructions.shared';

interface AddParams { entry: ImportEntry & { lax?: boolean }; overwrite?: boolean; lax?: boolean }

registerHandler('index_add', guard('index_add', (p: AddParams) => {
  const e = p.entry as ImportEntry | undefined;
  const instructionsCfg = getRuntimeConfig().instructions;
  const SEMVER_REGEX = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:[-+].*)?$/;
  const ADD_INPUT_SCHEMA = getToolRegistry({ tier: 'admin' }).find(t => t.name === 'index_add')?.inputSchema;
  const fail = (error: string, opts?: { id?: string; hash?: string }) => {
    const id = opts?.id || (e && e.id) || 'unknown';
    const rawBody = e && typeof e.body === 'string' ? e.body : (e && e.body ? String(e.body) : '');
    const bodyPreview = rawBody.trim().slice(0, 200);
    const reproEntry = e ? {
      id,
      title: (e as Partial<ImportEntry>).title || id,
      requirement: (e as Partial<ImportEntry>).requirement,
      priorityTier: (e as Partial<ImportEntry>).priorityTier,
      owner: (e as Partial<ImportEntry>).owner,
      bodyPreview
    } : { id };
    interface AddFailureResult {
      id: string; created: boolean; overwritten: boolean; skipped: boolean; error: string; hash?: string; feedbackHint: string; reproEntry: Record<string, unknown>; schemaRef?: string; inputSchema?: unknown;
    }
    const base: AddFailureResult = {
      id,
      created: false,
      overwritten: false,
      skipped: false,
      error,
      hash: opts?.hash,
      feedbackHint: 'Creation failed. If unexpected, call feedback_submit with reproEntry.',
      reproEntry
    };
    if (/^missing (entry|id|required fields)/.test(error) || error === 'missing required fields') {
      if (ADD_INPUT_SCHEMA) {
        base.schemaRef = "meta_tools[name='index_add'].inputSchema";
        base.inputSchema = ADD_INPUT_SCHEMA;
      } else {
        base.schemaRef = 'meta_tools (lookup index_add)';
      }
    }
    return base as typeof base;
  };
  const metadataEquals = (left: unknown, right: unknown) => {
    if (left === right) return true;
    if (left == null || right == null) return left === right;
    if (typeof left === 'object' || typeof right === 'object') {
      try {
        return JSON.stringify(left) === JSON.stringify(right);
      } catch {
        return false;
      }
    }
    return false;
  };
  if (!e) return fail('missing entry');
  const lax = !!(p.lax || (e as unknown as { lax?: boolean })?.lax);
  if (lax) {
    if (!e.id) return fail('missing id');
    const mutable = e as Partial<ImportEntry> & { id: string };
    if (!mutable.title) mutable.title = mutable.id;
    if (typeof mutable.priority !== 'number') mutable.priority = 50;
    if (!mutable.audience) mutable.audience = 'all' as InstructionEntry['audience'];
    if (!mutable.requirement) mutable.requirement = 'optional';
    if (!Array.isArray(mutable.categories)) mutable.categories = [];
  }
  if (p.overwrite && (!e.body || !e.title)) {
    try {
      // Try in-memory state first (covers SQLite and JSON backends), fall back to disk
      let raw: Partial<InstructionEntry> | undefined;
      const stHydrate = ensureLoaded();
      const memEntry = stHydrate.byId.get(e.id);
      if (memEntry) { raw = { ...memEntry }; }
      if (!raw) {
        const dirCandidate = getInstructionsDir();
        const fileCandidate = path.join(dirCandidate, `${e.id}.json`);
        if (fs.existsSync(fileCandidate)) {
          try { raw = JSON.parse(fs.readFileSync(fileCandidate, 'utf8')) as Partial<InstructionEntry>; } catch { /* ignore parse */ }
        }
      }
      if (raw) {
        const mutableExisting = e as Partial<InstructionEntry> & { id: string };
        if (!mutableExisting.body && typeof raw.body === 'string' && raw.body.trim()) {
          mutableExisting.body = raw.body;
        }
        if (!mutableExisting.title && typeof raw.title === 'string' && raw.title.trim()) {
          mutableExisting.title = raw.title;
        }
      }
    } catch { /* ignore hydration errors */ }
  }
  if (!e.id || !e.title || !e.body) return fail('missing required fields');
  const dir = getInstructionsDir(); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${e.id}.json`);
  const existsInStore = ensureLoaded().byId.has(e.id);
  const existsOnDisk = !existsInStore && fs.existsSync(file);
  const exists = existsInStore || existsOnDisk;
  const existedBeforeOriginal = exists;
  const overwrite = !!p.overwrite;
  if (exists && !overwrite) {
    let st0 = ensureLoaded(); let visible = st0.byId.has(e.id); let repaired = false; if (!visible) {
      try { invalidate(); st0 = ensureLoaded(); visible = st0.byId.has(e.id); if (visible) repaired = true; } catch { /* ignore reload */ }
    }
    logAudit('add', e.id, { skipped: true, late_visible: visible, repaired });
    if (traceVisibility()) { emitTrace('[trace:add:skip]', { id: e.id, visible, repaired }); }
    if (traceVisibility()) {
      traceInstructionVisibility(e.id, 'add-skip-pre-return', { visible, repaired });
      if (!visible) traceEnvSnapshot('add-skip-anomalous', { repaired });
    }
    if (!visible) { return { id: e.id, skipped: true, created: false, overwritten: false, hash: st0.hash, visibilityWarning: 'skipped_file_not_in_index' }; }
    return { id: e.id, skipped: true, created: false, overwritten: false, hash: st0.hash, repaired: repaired ? true : undefined };
  }
  const now = new Date().toISOString();
  const rawBody = typeof e.body === 'string' ? e.body : String(e.body || '');
  const bodyTrimmed = rawBody.trim();
  const { bodyWarnLength } = getRuntimeConfig().index;
  if (bodyTrimmed.length > bodyWarnLength) {
    return {
      ...fail('body_too_large', { id: e.id }),
      bodyLength: bodyTrimmed.length,
      maxLength: bodyWarnLength,
      guidance: `Body exceeds the ${bodyWarnLength}-character limit (${bodyTrimmed.length} chars). Please split into multiple cross-linked instructions, refine/compress content, or categorize sections as separate entries. Use categories and cross-references (e.g., "See also: <sibling-id>") to maintain discoverability.`
    };
  }
  let categories = Array.from(new Set((Array.isArray(e.categories) ? e.categories : []).filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map(c => c.toLowerCase()))).sort();
  if (!categories.length) {
    const allowAuto = lax || !instructionsCfg.requireCategory;
    if (allowAuto) {
      categories = ['uncategorized'];
      if (traceVisibility()) emitTrace('[trace:add:auto-category]', { id: e.id });
      incrementCounter('instructions:autoCategory');
    } else {
      return fail('category_required', { id: e.id });
    }
  }
  const suppliedPrimary = (e as unknown as Record<string, unknown>).primaryCategory as string | undefined;
  const primaryCategory = (suppliedPrimary && categories.includes(suppliedPrimary.toLowerCase())) ? suppliedPrimary.toLowerCase() : categories[0];
  const sourceHash = instructionsCfg.canonicalDisable
    ? crypto.createHash('sha256').update(bodyTrimmed, 'utf8').digest('hex')
    : hashBody(rawBody);
  if (e.priorityTier === 'P1' && (!categories.length || !e.owner)) return fail('P1 requires category & owner', { id: e.id });
  if ((e.requirement === 'mandatory' || e.requirement === 'critical') && !e.owner) return fail('mandatory/critical require owner', { id: e.id });
  const classifier = new ClassificationService();
  let base: InstructionEntry;
  if (exists) {
    try {
      let existing: InstructionEntry;
      // Try store first (covers SQLite), fall back to disk (JSON backend)
      const stMerge = ensureLoaded();
      const memEntry = stMerge.byId.get(e.id);
      if (memEntry) {
        existing = { ...memEntry };
      } else if (existsOnDisk) {
        existing = JSON.parse(fs.readFileSync(file, 'utf8')) as InstructionEntry;
      } else {
        throw new Error('entry not found in store or on disk');
      }
      base = { ...existing } as InstructionEntry;
      const prevBody = existing.body;
      const prevVersion = existing.version || '1.0.0';
      if (e.title) base.title = e.title;
      if (e.body) base.body = bodyTrimmed;
      if (e.rationale !== undefined) base.rationale = e.rationale;
      if (typeof e.priority === 'number') base.priority = e.priority;
      if (e.audience) base.audience = e.audience;
      if (e.requirement) base.requirement = e.requirement as InstructionEntry['requirement'];
      if (categories.length) { base.categories = categories; base.primaryCategory = primaryCategory; }
      base.updatedAt = now;
      if (e.version !== undefined) base.version = e.version;
      if (e.changeLog !== undefined) base.changeLog = e.changeLog as InstructionEntry['changeLog'];
      const semverRegex = SEMVER_REGEX;
      const parse = (v: string) => { const m = semverRegex.exec(v); if (!m) return null; return { major: +m[1], minor: +m[2], patch: +m[3] }; };
      const gt = (a: string, b: string) => { const pa = parse(a), pb = parse(b); if (!pa || !pb) return false; if (pa.major !== pb.major) return pa.major > pb.major; if (pa.minor !== pb.minor) return pa.minor > pb.minor; return pa.patch > pb.patch; };
      const bodyChanged = e.body ? (bodyTrimmed !== prevBody) : false;
      const titleChanged = e.title !== undefined && e.title !== existing.title;
      const eRec = e as unknown as Record<string, unknown>;
      const mutableMetadataKeys = ['owner', 'status', 'priorityTier', 'classification', 'lastReviewedAt', 'nextReviewDue', 'semanticSummary', 'contentType', 'extensions'] as const;
      const metadataChanged = mutableMetadataKeys.some((key) =>
        eRec[key] !== undefined && !metadataEquals(eRec[key], (existing as unknown as Record<string, unknown>)[key]),
      );
      const versionChanged = e.version !== undefined && e.version !== existing.version;
      const categoriesChanged = categories.length > 0 && JSON.stringify(categories.sort()) !== JSON.stringify((existing.categories || []).sort());
      const governanceMetaChanged = titleChanged || metadataChanged || versionChanged || categoriesChanged;
      if (overwrite && !bodyChanged && !governanceMetaChanged) {
        const stNoop = ensureLoaded();
        const respNoop: { id: string; created: boolean; overwritten: boolean; skipped: boolean; hash: string; verified: true; strictVerified?: true } = { id: e.id, created: false, overwritten: false, skipped: true, hash: stNoop.hash, verified: true };
        if (instructionsCfg.strictCreate) respNoop.strictVerified = true;
        logAudit('add', e.id, { created: false, overwritten: false, skipped: true, verified: true, noop: true });
        if (traceVisibility()) emitTrace('[trace:add:noop-overwrite]', { id: e.id, hash: stNoop.hash, reason: 'no body/governance delta' });
        return respNoop;
      }
      let incomingVersion = e.version;
      if (incomingVersion && !semverRegex.test(incomingVersion)) return fail('invalid_semver', { id: e.id });
      if (bodyChanged) {
        if (incomingVersion) {
          if (!gt(incomingVersion, prevVersion)) return fail('version_not_bumped', { id: e.id });
        } else {
          const pv = parse(prevVersion) || { major: 1, minor: 0, patch: 0 };
          const autoVersion = `${pv.major}.${pv.minor}.${pv.patch + 1}`;
          base.version = autoVersion;
          incomingVersion = autoVersion;
        }
      } else if (incomingVersion) {
        if (!gt(incomingVersion, prevVersion)) return fail('version_not_bumped', { id: e.id });
      } else {
        base.version = prevVersion;
        incomingVersion = prevVersion;
      }
      if (!Array.isArray(base.changeLog) || !base.changeLog.length) {
        base.changeLog = [{ version: prevVersion, changedAt: existing.createdAt || now, summary: 'initial import' }];
      }
      const finalVersion = base.version || incomingVersion || prevVersion;
      const last = base.changeLog[base.changeLog.length - 1];
      if (last.version !== finalVersion) {
        const summary = bodyChanged ? (e.version ? 'body update' : 'auto bump (body change)') : 'metadata update';
        base.changeLog.push({ version: finalVersion, changedAt: now, summary });
      }
      const repairChangeLog = (cl: unknown): InstructionEntry['changeLog'] => {
        interface CLRaw { version?: unknown; changedAt?: unknown; summary?: unknown }
        const out: InstructionEntry['changeLog'] = [];
        if (Array.isArray(cl)) {
          for (const entry of cl) {
            if (!entry || typeof entry !== 'object') continue;
            const { version: v, changedAt: ca, summary: sum } = entry as CLRaw;
            if (typeof v === 'string' && v.trim() && typeof sum === 'string' && sum.trim()) {
              const caIso = typeof ca === 'string' && /T/.test(ca) ? ca : now;
              out.push({ version: v.trim(), changedAt: caIso, summary: sum.trim() });
            }
          }
        }
        if (!out.length) {
          out.push({ version: prevVersion, changedAt: existing.createdAt || now, summary: 'initial import (repaired)' });
        }
        const lastVer = out[out.length - 1].version;
        if (lastVer !== finalVersion) {
          out.push({ version: finalVersion, changedAt: now, summary: bodyChanged ? 'body update (repaired)' : 'metadata update (repaired)' });
        }
        return out;
      };
      base.changeLog = repairChangeLog(base.changeLog);
    } catch {
      base = { id: e.id, title: e.title, body: bodyTrimmed, rationale: e.rationale, priority: e.priority, audience: e.audience, requirement: e.requirement, categories, primaryCategory, sourceHash, schemaVersion: SCHEMA_VERSION, deprecatedBy: e.deprecatedBy, createdAt: now, updatedAt: now, riskScore: e.riskScore, createdByAgent: instructionsCfg.agentId, sourceWorkspace: instructionsCfg.workspaceId, extensions: e.extensions } as InstructionEntry;
      base.version = '1.0.0';
      base.changeLog = [{ version: '1.0.0', changedAt: now, summary: 'initial import' }];
    }
  } else {
    base = { id: e.id, title: e.title, body: bodyTrimmed, rationale: e.rationale, priority: e.priority, audience: e.audience, requirement: e.requirement, categories, primaryCategory, sourceHash, schemaVersion: SCHEMA_VERSION, deprecatedBy: e.deprecatedBy, createdAt: now, updatedAt: now, riskScore: e.riskScore, createdByAgent: instructionsCfg.agentId, sourceWorkspace: instructionsCfg.workspaceId, extensions: e.extensions } as InstructionEntry;
    if (e.version !== undefined) {
      if (!SEMVER_REGEX.test(e.version)) return fail('invalid_semver', { id: e.id });
      base.version = e.version;
    } else {
      base.version = '1.0.0';
    }
    if (!Array.isArray(base.changeLog) || !base.changeLog.length) {
      base.changeLog = [{ version: base.version, changedAt: now, summary: 'initial import' }];
    }
    if (Array.isArray(base.changeLog)) {
      interface CLRaw { version?: unknown; changedAt?: unknown; summary?: unknown }
      const repaired: InstructionEntry['changeLog'] = [];
      for (const entry of base.changeLog) {
        if (!entry || typeof entry !== 'object') continue;
        const { version: v, changedAt: ca, summary: sum } = entry as CLRaw;
        if (typeof v === 'string' && v.trim() && typeof sum === 'string' && sum.trim()) {
          const caIso = typeof ca === 'string' && /T/.test(ca) ? ca : now;
          repaired.push({ version: v.trim(), changedAt: caIso, summary: sum.trim() });
        }
      }
      if (!repaired.length) {
        repaired.push({ version: base.version, changedAt: now, summary: 'initial import (repaired)' });
      }
      if (repaired[repaired.length - 1].version !== base.version) {
        repaired.push({ version: base.version, changedAt: now, summary: 'initial import (normalized)' });
      }
      base.changeLog = repaired;
    }
  }
  const govKeys: (keyof ImportEntry)[] = ['version', 'owner', 'status', 'priorityTier', 'classification', 'lastReviewedAt', 'nextReviewDue', 'semanticSummary', 'contentType', 'extensions'];
  for (const k of govKeys) { const v = (e as ImportEntry)[k]; if (v !== undefined) { (base as unknown as Record<string, unknown>)[k] = v as unknown; } }
  if (!base.sourceWorkspace) base.sourceWorkspace = instructionsCfg.workspaceId;
  if (!exists || base.body === bodyTrimmed) {
    base.sourceHash = sourceHash;
  } else {
    base.sourceHash = instructionsCfg.canonicalDisable
      ? crypto.createHash('sha256').update(base.body, 'utf8').digest('hex')
      : hashBody(base.body);
  }
  const record = classifier.normalize(base);
  if (record.owner === 'unowned') { const auto = resolveOwner(record.id); if (auto) { record.owner = auto; record.updatedAt = new Date().toISOString(); } }
  try { writeEntry(record); } catch (err) { return fail((err as Error).message || 'write-failed', { id: e.id }); }
  try { touchIndexVersion(); } catch { /* ignore */ }
  let stReloaded;
  const strictMode = instructionsCfg.strictVisibility;
  if (strictMode) {
    try {
      const current = ensureLoaded();
      stReloaded = current;
      if (!current.byId.has(record.id)) {
        current.byId.set(record.id, record);
        current.list.push(record);
      }
    } catch { /* fallback to reload path below if anything fails */ }
  }
  if (!stReloaded) {
    try { invalidate(); } catch { /* ignore */ }
    stReloaded = ensureLoaded();
  }
  const createdNow = !existedBeforeOriginal;
  const overwrittenNow = overwrite && existedBeforeOriginal;
  let strictVerified = false; const verifyIssues: string[] = [];
  try {
    let parsed: InstructionEntry | undefined;
    // Verify from in-memory store first (covers SQLite), fall back to disk (JSON backend)
    parsed = stReloaded.byId.get(e.id) ?? undefined;
    if (!parsed) {
      if (fs.existsSync(file)) {
        let diskRaw: string | undefined;
        try { diskRaw = fs.readFileSync(file, 'utf8'); } catch (ex) { verifyIssues.push('read-failed:' + (ex as Error).message); }
        if (diskRaw) {
          try { parsed = JSON.parse(diskRaw) as InstructionEntry; } catch (ex) { verifyIssues.push('parse-failed:' + (ex as Error).message); }
        }
      }
    }
    if (parsed) {
      if (parsed.id !== e.id) verifyIssues.push('id-mismatch');
      if (!parsed.title) verifyIssues.push('missing-title');
      if (!parsed.body) verifyIssues.push('missing-body');
      const wantCats = Array.isArray(e.categories) ? e.categories.filter((c): c is string => typeof c === 'string').map(c => c.toLowerCase()) : [];
      if (wantCats.length) {
        for (const c of wantCats) { if (!parsed.categories?.includes(c)) { verifyIssues.push('missing-category:' + c); } }
      }
    }
    const mem = stReloaded.byId.get(e.id);
    if (!mem) { verifyIssues.push('not-in-index'); }
    const wantCats2 = Array.isArray(e.categories) ? e.categories.filter((c): c is string => typeof c === 'string').map(c => c.toLowerCase()) : [];
    if (wantCats2.length) {
      const catHit = stReloaded.list.some(rec => rec.id === e.id && wantCats2.every(c => rec.categories.includes(c)));
      if (!catHit) verifyIssues.push('category-query-miss');
    }
    try {
      if (parsed) {
        const classifier2 = new ClassificationService();
        const issues = classifier2.validate(parsed as InstructionEntry);
        if (issues.length) { verifyIssues.push('classification-issues:' + issues.join(',')); }
      }
    } catch (err) { verifyIssues.push('classification-exception:' + (err as Error).message); }
    if (verifyIssues.includes('not-in-index')) {
      try { invalidate(); const st2 = ensureLoaded(); if (st2.byId.has(e.id)) { const idx = verifyIssues.indexOf('not-in-index'); if (idx >= 0) verifyIssues.splice(idx, 1); } } catch { /* ignore */ }
    }
    if (!verifyIssues.length) strictVerified = true;
  } catch (err) { verifyIssues.push('verify-exception:' + (err as Error).message); }
  try {
    if (instructionsCfg.manifest.writeEnabled) writeManifestFromIndex(); else setImmediate(() => { try { attemptManifestUpdate(); } catch { /* ignore */ } });
  } catch { /* ignore manifest */ }
  logAudit('add', e.id, { created: createdNow, overwritten: overwrittenNow, verified: true, forcedReload: true });
  if (traceVisibility()) emitTrace('[trace:add:forced-reload]', { id: e.id, created: createdNow, overwritten: overwrittenNow, hash: stReloaded.hash, strictVerified, issues: verifyIssues.slice(0, 5), strictMode });
  return { id: e.id, created: createdNow, overwritten: overwrittenNow, skipped: false, hash: stReloaded.hash, verified: true, strictVerified, verifyIssues: verifyIssues.length ? verifyIssues : undefined, strictMode, bodyLength: bodyTrimmed.length };
}));

export {};
