import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { InstructionEntry } from '../../models/instruction';
import { registerHandler } from '../../server/registry';
import { ensureLoadedAsync, getInstructionsDir, invalidate, isDuplicateInstructionWriteError, touchIndexVersion, writeEntryAsync } from '../indexContext';
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
import { INSTRUCTION_INPUT_SCHEMA_REF, validateInstructionInputSurface, validateInstructionRecord, sanitizeLoadError, sanitizeErrorDetail, type SanitizedLoadError } from '../instructionRecordValidation';
import { isInstructionValidationError } from '../instructionRecordValidation';
import { guard, ImportEntry, traceVisibility, traceInstructionVisibility, traceEnvSnapshot, normalizeInputCategories, repairChangeLog, ADD_GOVERNANCE_KEYS, applyGovernanceKeys } from './instructions.shared';

interface AddParams { entry: ImportEntry & { lax?: boolean }; overwrite?: boolean; lax?: boolean }

registerHandler('index_add', guard('index_add', async (p: AddParams) => {
  const e = p.entry as ImportEntry | undefined;
  const instructionsCfg = getRuntimeConfig().instructions;
  const SEMVER_REGEX = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:[-+].*)?$/;
  const ADD_INPUT_SCHEMA = getToolRegistry({ tier: 'admin' }).find(t => t.name === 'index_add')?.inputSchema;
  const fail = (error: string, opts?: { id?: string; hash?: string; message?: string; validationErrors?: string[]; hints?: string[]; errorCode?: string; detail?: string }) => {
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
      id: string; success: false; created: boolean; overwritten: boolean; skipped: boolean; error: string; hash?: string; message: string; feedbackHint: string; reproEntry: Record<string, unknown>; validationErrors?: string[]; hints?: string[]; schemaRef?: string; inputSchema?: unknown; errorCode?: string; detail?: string;
    }
    const base: AddFailureResult = {
      id,
      success: false,
      created: false,
      overwritten: false,
      skipped: false,
      error,
      hash: opts?.hash,
      message: opts?.message || 'Instruction not added.',
      feedbackHint: 'Instruction not added. Fix validationErrors or call feedback_submit with reproEntry.',
      reproEntry
    };
    if (opts?.validationErrors?.length) base.validationErrors = opts.validationErrors;
    if (opts?.hints?.length) base.hints = opts.hints;
    if (opts?.errorCode) base.errorCode = opts.errorCode;
    if (opts?.detail) base.detail = opts.detail;
    if (/^missing (entry|id|required fields)/.test(error) || error === 'missing required fields' || error === 'invalid_instruction') {
      base.schemaRef = INSTRUCTION_INPUT_SCHEMA_REF;
      if (ADD_INPUT_SCHEMA) base.inputSchema = ADD_INPUT_SCHEMA;
    }
    return base as typeof base;
  };
  const failValidation = (error: string, validationErrors: string[], hints: string[], opts?: { id?: string; hash?: string }) =>
    fail(error, { ...opts, validationErrors, hints, message: 'Instruction not added.' });
  const loadExistingEntry = async (id: string, filePath: string): Promise<{ entry?: InstructionEntry; error?: SanitizedLoadError }> => {
    let priorLoad: SanitizedLoadError | undefined;
    try {
      const stExisting = await ensureLoadedAsync();
      const memEntry = stExisting.byId.get(id);
      if (memEntry) return { entry: { ...memEntry } };
    } catch (err) {
      priorLoad = sanitizeLoadError(err, 'load_failed');
    }
    if (fs.existsSync(filePath)) {
      let diskRaw: string;
      try {
        diskRaw = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        return { error: sanitizeLoadError(err, 'load_failed') };
      }
      try {
        return { entry: JSON.parse(diskRaw) as InstructionEntry };
      } catch (err) {
        return { error: sanitizeLoadError(err, 'parse_failed') };
      }
    }
    if (priorLoad) return { error: priorLoad };
    return { error: { code: 'unknown', detail: 'missing-existing-entry', raw: 'missing-existing-entry' } };
  };
  const verifyReadBack = async (id: string, filePath: string, requestedCategories: unknown) => {
    try { invalidate(); } catch { /* ignore */ }
    const stReloaded = await ensureLoadedAsync();
    let strictVerified = false;
    const verifyIssues: string[] = [];
    try {
      let parsed: InstructionEntry | undefined;
      parsed = stReloaded.byId.get(id) ?? undefined;
      if (!parsed && fs.existsSync(filePath)) {
        let diskRaw: string | undefined;
        try { diskRaw = fs.readFileSync(filePath, 'utf8'); } catch (ex) { verifyIssues.push('read-failed:' + (ex as Error).message); }
        if (diskRaw) {
          try { parsed = JSON.parse(diskRaw) as InstructionEntry; } catch (ex) { verifyIssues.push('parse-failed:' + (ex as Error).message); }
        }
      }
      if (parsed) {
        if (parsed.id !== id) verifyIssues.push('id-mismatch');
        if (!parsed.title) verifyIssues.push('missing-title');
        if (!parsed.body) verifyIssues.push('missing-body');
        const wantCats = Array.isArray(requestedCategories)
          ? requestedCategories.filter((c): c is string => typeof c === 'string').map(c => c.toLowerCase())
          : [];
        if (wantCats.length) {
          for (const c of wantCats) {
            if (!parsed.categories?.includes(c)) verifyIssues.push('missing-category:' + c);
          }
        }
      }
      const mem = stReloaded.byId.get(id);
      if (!mem) verifyIssues.push('not-in-index');
      const wantCats2 = Array.isArray(requestedCategories)
        ? requestedCategories.filter((c): c is string => typeof c === 'string').map(c => c.toLowerCase())
        : [];
      if (wantCats2.length) {
        const catHit = stReloaded.list.some(rec => rec.id === id && wantCats2.every(c => rec.categories.includes(c)));
        if (!catHit) verifyIssues.push('category-query-miss');
      }
      try {
        if (parsed) {
          const classifier2 = new ClassificationService();
          const issues = classifier2.validate(parsed as InstructionEntry);
          if (issues.length) verifyIssues.push('classification-issues:' + issues.join(','));
        }
      } catch (err) {
        verifyIssues.push('classification-exception:' + (err as Error).message);
      }
      if (verifyIssues.includes('not-in-index')) {
        try {
          invalidate();
          const st2 = await ensureLoadedAsync();
          if (st2.byId.has(id)) {
            const idx = verifyIssues.indexOf('not-in-index');
            if (idx >= 0) verifyIssues.splice(idx, 1);
          }
        } catch { /* ignore */ }
      }
      if (!verifyIssues.length) strictVerified = true;
    } catch (err) {
      verifyIssues.push('verify-exception:' + (err as Error).message);
    }
    return {
      stReloaded,
      strictVerified,
      verifyIssues,
      verified: strictVerified && verifyIssues.length === 0,
    };
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
    // Only fill defaults for *missing* fields. Never silently coerce a wrong-typed value:
    // shape violations are surfaced as invalid_instruction by validateInstructionInputSurface.
    if (mutable.title === undefined) mutable.title = mutable.id;
    if (mutable.priority === undefined) mutable.priority = 50;
    if (mutable.audience === undefined) mutable.audience = 'all' as InstructionEntry['audience'];
    if (mutable.requirement === undefined) mutable.requirement = 'optional';
    if (mutable.categories === undefined) mutable.categories = [];
  }
  const dir = getInstructionsDir(); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${e.id}.json`);
  if (p.overwrite && (!e.body || !e.title)) {
      const hydrated = await loadExistingEntry(e.id, file);
    if (hydrated.entry) {
      const mutableExisting = e as Partial<InstructionEntry> & { id: string };
      if (!mutableExisting.body && typeof hydrated.entry.body === 'string' && hydrated.entry.body.trim()) {
        mutableExisting.body = hydrated.entry.body;
      }
      if (!mutableExisting.title && typeof hydrated.entry.title === 'string' && hydrated.entry.title.trim()) {
        mutableExisting.title = hydrated.entry.title;
      }
    } else if (hydrated.error) {
      // Surface all read failures, including those combined with 'missing-existing-entry'
      const hasRealError = hydrated.error.detail !== 'missing-existing-entry';
      if (hasRealError) {
        logAudit('add_hydration_error', e.id, { error: hydrated.error.raw, errorCode: hydrated.error.code, overwrite: true });
        return fail('existing_instruction_unreadable', {
          id: e.id,
          message: `Existing instruction could not be hydrated for overwrite (${hydrated.error.code}): ${hydrated.error.detail}`,
          errorCode: hydrated.error.code,
          detail: hydrated.error.detail,
        });
      }
    }
  }
  const requiredFieldErrors = [
    !e.id ? 'id: missing required field' : undefined,
    e.title === undefined ? 'title: missing required field' : undefined,
    e.body === undefined ? 'body: missing required field' : undefined,
  ].filter((issue): issue is string => !!issue);
  const surfaceValidation = validateInstructionInputSurface(e as unknown as Record<string, unknown>);
  if (requiredFieldErrors.length || surfaceValidation.validationErrors.length) {
    return failValidation(
      requiredFieldErrors.length ? 'missing required fields' : 'invalid_instruction',
      [...requiredFieldErrors, ...surfaceValidation.validationErrors],
      surfaceValidation.hints,
      { id: e.id },
    );
  }
  const overwrite = !!p.overwrite;
  const exists = overwrite ? ((await ensureLoadedAsync()).byId.has(e.id) || fs.existsSync(file)) : false;
  const existedBeforeOriginal = exists;
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
  let categories = normalizeInputCategories(e.categories);
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
    const existingLoad = await loadExistingEntry(e.id, file);
    if (!existingLoad.entry) {
      const errCode = existingLoad.error?.code ?? 'unknown';
      const errDetail = existingLoad.error?.detail ?? 'missing-existing-entry';
      return fail('existing_instruction_unreadable', {
        id: e.id,
        message: `Existing instruction could not be read for overwrite (${errCode}): ${errDetail}`,
        errorCode: errCode,
        detail: errDetail,
      });
    }
    const existing = existingLoad.entry;
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
      // Noop overwrite: no mutation needed because the incoming entry matches
      // the existing record. Even so, verify the persisted state still matches
      // the in-memory index — the file (or store row) may have disappeared
      // since the index was last loaded. Skipping verification here would mean
      // silently reporting success when the entry is no longer durable.
      const verification = await verifyReadBack(e.id, file, e.categories);
      const noopVerified = verification.verified;
      logAudit('add', e.id, {
        created: false,
        overwritten: false,
        skipped: true,
        verified: noopVerified,
        strictVerified: verification.strictVerified,
        verifyIssues: verification.verifyIssues.length ? verification.verifyIssues : undefined,
        noop: true,
        note: noopVerified ? 'noop_verified' : 'noop_read_back_failed',
      });
      if (traceVisibility()) emitTrace('[trace:add:noop-overwrite]', {
        id: e.id,
        hash: verification.stReloaded.hash,
        verified: noopVerified,
        strictVerified: verification.strictVerified,
        issues: verification.verifyIssues.slice(0, 5),
        reason: noopVerified
          ? 'no body/governance delta — persisted state verified'
          : 'no body/governance delta — persisted state verification failed',
      });
      if (!noopVerified) {
        return {
          ...fail('read-back verification failed', {
            id: e.id,
            hash: verification.stReloaded.hash,
            message: 'Noop overwrite rejected: persisted instruction state does not match the in-memory index.',
            validationErrors: verification.verifyIssues,
          }),
          created: false,
          overwritten: false,
          verified: false,
          strictVerified: verification.strictVerified,
          verifyIssues: verification.verifyIssues,
        };
      }
      const respNoop: {
        id: string;
        success: true;
        created: boolean;
        overwritten: boolean;
        skipped: boolean;
        hash: string;
        verified: boolean;
        note: string;
        strictVerified?: boolean;
      } = {
        id: e.id,
        success: true,
        created: false,
        overwritten: false,
        skipped: true,
        hash: verification.stReloaded.hash,
        verified: true,
        note: 'noop_verified',
      };
      if (instructionsCfg.strictCreate) {
        respNoop.strictVerified = verification.strictVerified;
      }
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
    base.changeLog = repairChangeLog(base.changeLog, {
      finalVersion,
      now,
      fallback: { version: prevVersion, changedAt: existing.createdAt || now, summary: 'initial import (repaired)' },
      trailingSummary: bodyChanged ? 'body update (repaired)' : 'metadata update (repaired)'
    });
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
      base.changeLog = repairChangeLog(base.changeLog, {
        finalVersion: base.version,
        now,
        fallback: { version: base.version, changedAt: now, summary: 'initial import (repaired)' },
        trailingSummary: 'initial import (normalized)'
      });
    }
  }
  applyGovernanceKeys(base, e as ImportEntry, ADD_GOVERNANCE_KEYS);
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
  const recordValidation = validateInstructionRecord(record);
  if (recordValidation.validationErrors.length) {
    return failValidation('invalid_instruction', recordValidation.validationErrors, recordValidation.hints, { id: e.id });
  }
  try { await writeEntryAsync(record, overwrite ? undefined : { createOnly: true }); } catch (err) {
    if (isInstructionValidationError(err)) {
      return failValidation('invalid_instruction', err.validationErrors, err.hints, { id: e.id });
    }
    if (!overwrite && isDuplicateInstructionWriteError(err)) {
      let st0 = await ensureLoadedAsync(); let visible = st0.byId.has(e.id); let repaired = false; if (!visible) {
        try { invalidate(); st0 = await ensureLoadedAsync(); visible = st0.byId.has(e.id); if (visible) repaired = true; } catch { /* ignore reload */ }
      }
      logAudit('add', e.id, { skipped: true, late_visible: visible, repaired, duplicateAtWrite: true });
      if (traceVisibility()) { emitTrace('[trace:add:skip]', { id: e.id, visible, repaired, duplicateAtWrite: true }); }
      if (traceVisibility()) {
        traceInstructionVisibility(e.id, 'add-skip-post-write-conflict', { visible, repaired });
        if (!visible) traceEnvSnapshot('add-skip-anomalous', { repaired });
      }
      if (!visible) {
        const existingLoadError = st0.loadErrors?.find((issue) => {
          const fileName = path.basename(issue.file);
          return issue.file === `${e.id}.json` || fileName === `${e.id}.json` || issue.file.endsWith(`\\${e.id}.json`);
        });
        if (existingLoadError) {
          return {
            id: e.id,
            success: false,
            skipped: false,
            created: false,
            overwritten: false,
            hash: st0.hash,
            error: 'existing_instruction_invalid',
            validationErrors: [sanitizeErrorDetail(existingLoadError.error) || 'existing entry could not be parsed'],
          };
        }
        return { id: e.id, success: true, skipped: true, created: false, overwritten: false, hash: st0.hash, visibilityWarning: 'skipped_file_not_in_index' };
      }
      return { id: e.id, success: true, skipped: true, created: false, overwritten: false, hash: st0.hash, repaired: repaired ? true : undefined };
    }
    // Catch-all: never expose raw Node error text (ENOENT, null-byte path errors, stack frames) to MCP clients.
    return fail('write_failed', {
      id: e.id,
      message: 'Instruction write failed due to an internal error. The error details are not exposed to clients.',
    });
  }
  try { touchIndexVersion(); } catch { /* ignore */ }
  const strictMode = instructionsCfg.strictVisibility || instructionsCfg.strictCreate;
  const createdNow = !existedBeforeOriginal;
  const overwrittenNow = overwrite && existedBeforeOriginal;
  const verification = await verifyReadBack(e.id, file, e.categories);
  try {
    if (instructionsCfg.manifest.writeEnabled) writeManifestFromIndex(); else setImmediate(() => { try { attemptManifestUpdate(); } catch { /* ignore */ } });
  } catch { /* ignore manifest */ }
  logAudit('add', e.id, {
    created: createdNow,
    overwritten: overwrittenNow,
    verified: verification.verified,
    strictVerified: verification.strictVerified,
    verifyIssues: verification.verifyIssues.length ? verification.verifyIssues : undefined,
    forcedReload: true,
  });
  if (traceVisibility()) emitTrace('[trace:add:forced-reload]', {
    id: e.id,
    created: createdNow,
    overwritten: overwrittenNow,
    hash: verification.stReloaded.hash,
    verified: verification.verified,
    strictVerified: verification.strictVerified,
    issues: verification.verifyIssues.slice(0, 5),
    strictMode,
  });
  if (!verification.verified) {
    return {
      ...fail('read-back verification failed', {
        id: e.id,
        hash: verification.stReloaded.hash,
        message: 'Instruction write completed but read-back verification failed.',
        validationErrors: verification.verifyIssues,
      }),
      created: createdNow,
      overwritten: overwrittenNow,
      verified: false,
      strictVerified: verification.strictVerified,
      verifyIssues: verification.verifyIssues,
      strictMode,
      bodyLength: bodyTrimmed.length,
    };
  }
  return {
    id: e.id,
    success: true,
    created: createdNow,
    overwritten: overwrittenNow,
    skipped: false,
    hash: verification.stReloaded.hash,
    verified: verification.verified,
    strictVerified: verification.strictVerified,
    verifyIssues: undefined,
    strictMode,
    bodyLength: bodyTrimmed.length,
  };
}));

export {};
