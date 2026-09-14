// index_patch — partial instruction body patching (#486).
//
// Rationale (DC-2): the only pre-existing way to change a body was `index_add`
// with `overwrite:true`, which requires resending the entire body. That costs
// tokens twice, risks silent truncation when an LLM regenerates a large body,
// and offers no lost-update protection. This handler mutates a body in place
// via bounded operations and an optional `expectedSourceHash` precondition.
//
// NOTE: this file is separate from `instructions.patch.ts`, which despite its
// name hosts the GOVERNANCE surface (index_governanceHash / index_governanceUpdate).
import crypto from 'crypto';
import { InstructionEntry } from '../../models/instruction';
import { registerHandler } from '../../server/registry';
import { ensureLoaded, invalidate, safeMarkStaleEmbedding, touchIndexVersion, writeEntry } from '../indexContext';
import { logAudit } from '../auditLog';
import { attemptManifestUpdate } from '../manifestManager';
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { hashBody } from '../canonical';
import { guard, bumpVersion, createChangeLogEntry, clampBodyOffset, normalizeInputCategories, snapWindowEnd } from './instructions.shared';

/** Operations supported by `index_patch`. */
export const PATCH_OPS = ['splice', 'append', 'prepend', 'replace', 'metadata'] as const;
export type PatchOp = (typeof PATCH_OPS)[number];

export interface PatchParams {
  id?: string;
  op?: string;
  /** Text to insert (splice) or concatenate (append/prepend). */
  text?: string;
  /** Splice window start, in UTF-16 code units. Mirrors `get`'s bodyOffset. */
  bodyOffset?: number;
  /** Number of code units to remove at bodyOffset. Defaults to 0 (pure insert). */
  bodyLength?: number;
  /** Literal substring to find (replace). Never interpreted as a regex. */
  find?: string;
  replaceWith?: string;
  replaceAll?: boolean;
  /** Optimistic-concurrency precondition; refuse if the stored hash differs. */
  expectedSourceHash?: string;
  bump?: 'patch' | 'minor' | 'major' | 'none';
  summary?: string;
  dryRun?: boolean;
  /** Metadata fields (op: 'metadata' only) */
  title?: string;
  semanticSummary?: string;
  categories?: string[];
  primaryCategory?: string;
  contentType?: string;
}

interface PatchFailure { id: string; error: string; reason?: string; [k: string]: unknown }

function failure(id: string, error: string, extra: Record<string, unknown> = {}): PatchFailure {
  logAudit('patch', id, { changed: false, error, ...extra });
  return { id, error, ...extra };
}

/**
 * Apply the requested operation to `body`, returning the new body or a failure.
 * Pure: performs no I/O and mutates nothing.
 */
function applyOp(id: string, op: PatchOp, body: string, p: PatchParams): { body: string } | { failure: PatchFailure } {
  switch (op) {
    case 'append':
    case 'prepend': {
      if (typeof p.text !== 'string') {
        return { failure: failure(id, 'invalid_params', { reason: `op "${op}" requires a string "text" parameter` }) };
      }
      return { body: op === 'append' ? body + p.text : p.text + body };
    }
    case 'splice': {
      if (typeof p.bodyOffset !== 'number' || !Number.isFinite(p.bodyOffset)) {
        return { failure: failure(id, 'invalid_params', { reason: 'op "splice" requires a numeric "bodyOffset" parameter' }) };
      }
      const text = typeof p.text === 'string' ? p.text : '';
      // Window resolution is shared with the `get` read path so a window that
      // was read out can be written back over exactly the same characters (DI-4).
      const start = clampBodyOffset(body, p.bodyOffset);
      const removeRaw = typeof p.bodyLength === 'number' && Number.isFinite(p.bodyLength)
        ? Math.max(Math.trunc(p.bodyLength), 0)
        : 0;
      const end = snapWindowEnd(body, start, start + removeRaw);
      return { body: body.slice(0, start) + text + body.slice(end) };
    }
    case 'replace': {
      if (typeof p.find !== 'string' || p.find.length === 0) {
        return { failure: failure(id, 'invalid_params', { reason: 'op "replace" requires a non-empty "find" parameter' }) };
      }
      const replaceWith = typeof p.replaceWith === 'string' ? p.replaceWith : '';
      if (!body.includes(p.find)) {
        return { failure: failure(id, 'find_not_found', { find: p.find }) };
      }
      if (p.replaceAll === true) {
        // split/join keeps `find` literal; String.replace would honour $-patterns.
        return { body: body.split(p.find).join(replaceWith) };
      }
      const at = body.indexOf(p.find);
      return { body: body.slice(0, at) + replaceWith + body.slice(at + p.find.length) };
    }
    default:
      return { failure: failure(id, 'invalid_params', { reason: `unknown op "${op}"`, validOps: [...PATCH_OPS] }) };
  }
}

registerHandler('index_patch', guard('index_patch', (p: PatchParams) => {
  const id = typeof p?.id === 'string' ? p.id.trim() : '';
  if (!id) {
    return { id: 'unknown', error: 'invalid_params', reason: 'missing required "id" parameter' };
  }
  const op = p.op as PatchOp;
  if (typeof p.op !== 'string' || !(PATCH_OPS as readonly string[]).includes(p.op)) {
    return failure(id, 'invalid_params', { reason: `unknown op "${String(p.op)}"`, validOps: [...PATCH_OPS] });
  }

  const st = ensureLoaded();
  const existing = st.byId.get(id);
  if (!existing) {
    logAudit('patch', id, { changed: false, notFound: true });
    return { id, notFound: true };
  }

  const previousBody = typeof existing.body === 'string' ? existing.body : '';
  const previousSourceHash = existing.sourceHash;

  // Optimistic concurrency: refuse before computing or writing anything.
  if (typeof p.expectedSourceHash === 'string' && p.expectedSourceHash !== previousSourceHash) {
    return failure(id, 'precondition_failed', {
      expectedSourceHash: p.expectedSourceHash,
      actualSourceHash: previousSourceHash,
      hint: 'The instruction changed since it was read. Re-read the entry and retry the patch against the current sourceHash.',
    });
  }

  // ── metadata op: update title/semanticSummary/categories/primaryCategory/contentType ──
  if (op === 'metadata') {
    const record: InstructionEntry = { ...existing };
    const prevTitle = existing.title;
    const prevSS = existing.semanticSummary;
    let changed = false;

    if (typeof p.title === 'string' && p.title.trim() && p.title.trim() !== existing.title) {
      record.title = p.title.trim();
      changed = true;
    }
    if (typeof p.semanticSummary === 'string') {
      const ss = p.semanticSummary.trim();
      if (ss.length > 600) {
        return failure(id, 'invalid_params', { reason: 'semanticSummary exceeds 600 character limit', length: ss.length });
      }
      if (ss && ss !== existing.semanticSummary) {
        record.semanticSummary = ss;
        changed = true;
      }
    }
    if (Array.isArray(p.categories) && p.categories.length > 0) {
      const cats = normalizeInputCategories(p.categories);
      if (cats.length > 0 && JSON.stringify(cats) !== JSON.stringify([...(existing.categories || [])].sort())) {
        record.categories = cats;
        const pc = p.primaryCategory?.trim().toLowerCase() || cats[0];
        record.primaryCategory = cats.includes(pc) ? pc : cats[0];
        changed = true;
      }
    } else if (typeof p.primaryCategory === 'string' && p.primaryCategory.trim()) {
      const pc = p.primaryCategory.trim().toLowerCase();
      const existingCats = (existing.categories || []).map(c => c.toLowerCase());
      if (existingCats.length > 0 && !existingCats.includes(pc)) {
        return failure(id, 'invalid_params', { reason: 'primaryCategory must be a member of categories', primaryCategory: pc, categories: existing.categories });
      }
      if (pc !== existing.primaryCategory) {
        record.primaryCategory = pc;
        changed = true;
      }
    }
    if (typeof p.contentType === 'string' && p.contentType.trim() && p.contentType.trim() !== existing.contentType) {
      record.contentType = p.contentType.trim() as InstructionEntry['contentType'];
      changed = true;
    }

    if (!changed) return { id, changed: false, op };

    const now = new Date().toISOString();
    const bump = p.bump && p.bump !== 'none' ? p.bump : null;
    const bumpedVersion = bump ? bumpVersion(existing.version, bump) : null;

    if (bumpedVersion && bumpedVersion !== existing.version) {
      record.version = bumpedVersion;
      record.changeLog = [
        ...(existing.changeLog || []),
        createChangeLogEntry(bumpedVersion, p.summary?.trim() || 'metadata update via index_patch'),
      ];
    }
    record.updatedAt = now;

    if (p.dryRun === true) {
      return {
        id, changed: true, dryRun: true, op,
        sourceHash: existing.sourceHash,
        version: bumpedVersion ?? existing.version,
      };
    }

    try { writeEntry(record); } catch (err) {
      const detail = (err as Error).message || 'unknown';
      const safeDetail = detail.replace(/[A-Za-z]:\\[^\s'"`]+/g, '<redacted-path>').replace(/\/(?:[^\s/'"`]+\/)+[^\s/'"`]+/g, '<redacted-path>');
      logAudit('patch', id, { changed: false, error: detail, writeFailure: true, op });
      return { id, error: 'write-failed', detail: safeDetail };
    }

    touchIndexVersion(); invalidate(); ensureLoaded();

    if (record.title !== prevTitle || record.semanticSummary !== prevSS) {
      safeMarkStaleEmbedding(id);
    }

    const resp = {
      id, changed: true, op,
      sourceHash: existing.sourceHash,
      version: record.version,
      updatedAt: now,
      title: record.title,
      semanticSummary: record.semanticSummary,
      categories: record.categories,
      primaryCategory: record.primaryCategory,
      contentType: record.contentType,
    };
    logAudit('patch', id, { changed: true, op, version: record.version });
    attemptManifestUpdate();
    return resp;
  }

  const applied = applyOp(id, op, previousBody, p);
  if ('failure' in applied) return applied.failure;
  const nextBody = applied.body;

  if (nextBody === previousBody) {
    return { id, changed: false, op, bodyLength: nextBody.length };
  }

  // A-6: body-size limits are enforced at every write path. Without this,
  // repeated appends would be a trivial bypass of the index_add/index_import cap.
  const { bodyWarnLength } = getRuntimeConfig().index;
  if (nextBody.length > bodyWarnLength) {
    return failure(id, 'body_limit_exceeded', {
      bodyLength: nextBody.length,
      maxLength: bodyWarnLength,
      guidance: `Body exceeds the ${bodyWarnLength}-character limit (${nextBody.length} chars). Please split into multiple cross-linked instructions, refine/compress content, or categorize sections as separate entries. Use categories and cross-references (e.g., "See also: <sibling-id>") to maintain discoverability.`,
    });
  }
  if (!nextBody.trim().length) {
    return failure(id, 'empty_body', { reason: 'patch would leave the instruction body empty' });
  }

  const instructionsCfg = getRuntimeConfig().instructions;
  // Deliberately NOT trimmed (unlike index_add): trimming would shift character
  // offsets and break round-trip symmetry with the windowed `get` read (DI-4).
  const sourceHash = instructionsCfg.canonicalDisable
    ? crypto.createHash('sha256').update(nextBody, 'utf8').digest('hex')
    : hashBody(nextBody);
  const now = new Date().toISOString();
  const bump = p.bump && p.bump !== 'none' ? p.bump : null;
  const bumpedVersion = bump ? bumpVersion(existing.version, bump) : null;
  const nextVersion = bumpedVersion ?? existing.version;

  if (p.dryRun === true) {
    return {
      id,
      changed: true,
      dryRun: true,
      op,
      sourceHash,
      previousSourceHash,
      bodyLength: nextBody.length,
      previousBodyLength: previousBody.length,
      version: nextVersion,
    };
  }

  const record: InstructionEntry = { ...existing, body: nextBody, sourceHash, updatedAt: now };
  if (bumpedVersion && bumpedVersion !== existing.version) {
    record.version = bumpedVersion;
    record.changeLog = [
      ...(existing.changeLog || []),
      createChangeLogEntry(bumpedVersion, p.summary?.trim() || `patched via index_patch (${op})`),
    ];
  }

  try {
    writeEntry(record);
  } catch (err) {
    const detail = (err as Error).message || 'unknown';
    const errorType = err instanceof Error ? err.constructor.name : typeof err;
    const stack = err instanceof Error ? err.stack?.slice(0, 500) : undefined;
    // #132 parity: full detail (including paths) stays in the audit log; the
    // caller receives a path-redacted version.
    const safeDetail = detail.replace(/[A-Za-z]:\\[^\s'"`]+/g, '<redacted-path>').replace(/\/(?:[^\s/'"`]+\/)+[^\s/'"`]+/g, '<redacted-path>');
    logAudit('patch', id, { changed: false, error: detail, errorType, stack, writeFailure: true, op });
    return { id, error: 'write-failed', detail: safeDetail, errorType };
  }

  touchIndexVersion();
  invalidate();
  ensureLoaded();

  const resp = {
    id,
    changed: true,
    op,
    sourceHash,
    previousSourceHash,
    bodyLength: nextBody.length,
    previousBodyLength: previousBody.length,
    version: record.version,
    updatedAt: now,
  };
  logAudit('patch', id, { changed: true, op, sourceHash, previousSourceHash, bodyLength: nextBody.length, version: record.version });
  attemptManifestUpdate();
  return resp;
}));

export {};
