// Shared utilities used across instruction handler submodules.
import crypto from 'crypto';
import { InstructionEntry, InstructionLink, LINK_RELS, LinkRel } from '../../models/instruction';
import { ensureLoaded } from '../indexContext';
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { emitTrace, traceEnabled } from '../tracing';

export function looksLikeInstruction(raw: Record<string, unknown>): boolean {
  return typeof raw.id === 'string' && typeof raw.title === 'string' && typeof raw.body === 'string';
}

export function isMutationEnabled() {
  return getRuntimeConfig().mutation.enabled;
}

export function isCI(): boolean {
  const ctx = getRuntimeConfig().instructions.ciContext;
  return ctx.inCI || ctx.githubActions || ctx.tfBuild;
}

/** Default number of leading body characters retained in a body-light item preview. */
export const BODY_PREVIEW_CHARS = 280;

/**
 * Produce a "body-light" projection of an instruction entry: the full `body`
 * string is replaced with a short `bodyPreview` plus `bodyLength`. Used by the
 * list/search read actions so large multi-entry responses stay within MCP
 * client tool-result budgets. Callers that need the full body should use the
 * `get` action (optionally paginated) or pass `includeBody: true`.
 */
export function lightenEntry<T extends { body?: unknown }>(entry: T, previewChars = BODY_PREVIEW_CHARS): Omit<T, 'body'> & { bodyPreview: string; bodyLength: number; bodyOmitted: true } {
  const body = typeof entry.body === 'string' ? entry.body : '';
  const { body: _omitted, ...rest } = entry as T & Record<string, unknown>;
  return {
    ...(rest as Omit<T, 'body'>),
    bodyPreview: body.slice(0, previewChars),
    bodyLength: body.length,
    bodyOmitted: true,
  };
}

/** Map an array of entries to their body-light projections (no-op when includeBody is true). */
export function lightenItems<T extends { body?: unknown }>(items: T[], includeBody: boolean, previewChars = BODY_PREVIEW_CHARS): unknown[] {
  return includeBody ? items : items.map(i => lightenEntry(i, previewChars));
}

function isHighSurrogate(code: number): boolean { return code >= 0xd800 && code <= 0xdbff; }
function isLowSurrogate(code: number): boolean { return code >= 0xdc00 && code <= 0xdfff; }

/**
 * Clamp a caller-supplied body offset into `[0, body.length]` and snap it off
 * the low half of a surrogate pair.
 *
 * Shared by the windowed READ path ({@link applyBodyPagination}) and the
 * windowed WRITE path (`index_patch` splice) so a window that was read back
 * can be written back over exactly the same characters (DI-4).
 */
export function clampBodyOffset(body: string, offsetRaw: number | undefined): number {
  const total = body.length;
  let offset = Math.min(Math.max(Math.trunc(offsetRaw ?? 0), 0), total);
  if (offset > 0 && offset < total && isLowSurrogate(body.charCodeAt(offset)) && isHighSurrogate(body.charCodeAt(offset - 1))) {
    offset -= 1;
  }
  return offset;
}

/**
 * Clamp a window end into `[start, body.length]` and snap it back so a
 * surrogate pair is never split at the trailing boundary. Companion to
 * {@link clampBodyOffset}; shared by the read and write windowed paths.
 */
export function snapWindowEnd(body: string, start: number, endRaw: number): number {
  const total = body.length;
  let end = Math.min(Math.max(endRaw, start), total);
  if (end > start && end < total && isHighSurrogate(body.charCodeAt(end - 1)) && isLowSurrogate(body.charCodeAt(end))) {
    end -= 1;
  }
  return end;
}

export interface BodyPagination {
  offset: number;
  length: number;
  totalBodyLength: number;
  hasMore: boolean;
  nextOffset: number | null;
}

/**
 * Apply deterministic character-window pagination to a `get` response body.
 * When neither bodyOffset nor bodyLimit is supplied the response is returned
 * unchanged (full body) for backward compatibility. Window boundaries are
 * snapped so a UTF-16 surrogate pair is never split across pages.
 */
export function applyBodyPagination<T extends { item: { body?: unknown } }>(
  resp: T,
  opts: { bodyOffset?: number; bodyLimit?: number }
): T | (T & { bodyPagination: BodyPagination }) {
  const { bodyOffset, bodyLimit } = opts;
  if (bodyOffset === undefined && bodyLimit === undefined) return resp;
  const body = typeof resp.item.body === 'string' ? resp.item.body : '';
  const total = body.length;
  // If the requested offset lands on the low half of a surrogate pair, step
  // back so we begin on the pair boundary (the previous page ended there too).
  const offset = clampBodyOffset(body, bodyOffset);
  const limit = bodyLimit !== undefined && bodyLimit > 0 ? Math.trunc(bodyLimit) : total - offset;
  // Never split a surrogate pair at the page boundary.
  const end = snapWindowEnd(body, offset, offset + limit);
  const chunk = body.slice(offset, end);
  const hasMore = end < total;
  return {
    ...resp,
    item: { ...resp.item, body: chunk },
    bodyPagination: { offset, length: chunk.length, totalBodyLength: total, hasMore, nextOffset: hasMore ? end : null },
  };
}

export function limitResponseSize<T extends Record<string, unknown>>(response: T): T {
  if (!isCI()) return response;

  const responseStr = JSON.stringify(response);
  if (responseStr.length <= 60000) return response;

  if ('items' in response && Array.isArray(response.items) && response.items.length > 3) {
    return {
      ...response,
      items: response.items.slice(0, 3),
      ciLimited: true,
      originalCount: response.items.length,
      message: 'Response limited in CI environment to prevent truncation'
    };
  }

  return response;
}

export interface ImportEntry {
  id: string; title: string; body: string; rationale?: string; priority: number;
  audience: InstructionEntry['audience']; requirement: InstructionEntry['requirement'];
  categories?: unknown[]; deprecatedBy?: string; riskScore?: number;
  version?: string; owner?: string; status?: InstructionEntry['status'];
  priorityTier?: InstructionEntry['priorityTier']; classification?: InstructionEntry['classification'];
  lastReviewedAt?: string; nextReviewDue?: string; changeLog?: InstructionEntry['changeLog'];
  semanticSummary?: string; contentType?: InstructionEntry['contentType'];
  extensions?: InstructionEntry['extensions'];
  // Caller-settable scoping / governance fields (#350). Previously absent
  // from this DTO so they were silently dropped between the input-surface
  // validator and the persisted record. Listing them keeps the type honest
  // about what the public schema accepts.
  teamIds?: string[]; workspaceId?: string; userId?: string;
  supersedes?: string; reviewIntervalDays?: number;
  links?: InstructionLink[];
}

/**
 * Wrap a mutation handler so it refuses to run under an explicit read-only
 * runtime (`INDEX_SERVER_MUTATION=0`, constitution S-3).
 *
 * There is deliberately NO caller-supplied escape hatch. This check previously
 * skipped whenever the params object carried `_viaDispatcher: true`. That key
 * was stamped by `instructions.dispatcher.ts`, but it was equally settable by
 * any MCP client: `sdkServer.ts` passes `req.params.arguments` verbatim and no
 * layer strips unknown keys, so a forged flag bought a real write under a
 * runtime the operator had declared read-only (issue #580). The dispatcher now
 * refuses mutation targets itself before reaching a handler, so no legitimate
 * caller needs an exemption and the origin signal is gone entirely.
 *
 * The old message also named `index_dispatch` as the workaround — it was
 * handing the caller the bypass — so the guidance now points at the env var.
 *
 * @param name - Tool name, surfaced in the error payload
 * @param fn - The real handler, run only when mutations are permitted
 * @throws {{code:-32601}} when `INDEX_SERVER_MUTATION` is falsy
 */
export function guard<TParams, TResult>(name: string, fn: (p: TParams) => TResult) {
  return (p: TParams) => {
    if (!isMutationEnabled()) {
      throw { code: -32601, message: `Mutations are disabled: this server was started with INDEX_SERVER_MUTATION=0 (explicit read-only runtime). ${name} is refused, and so is every other write path including index_dispatch. Restart the server without INDEX_SERVER_MUTATION=0 to re-enable writes.`, data: { method: name, reason: 'mutation_disabled' } };
    }
    return fn(p);
  };
}

export function traceVisibility() { return traceEnabled(1); }

export function traceInstructionVisibility(id: string, phase: string, extra?: Record<string, unknown>) {
  if (!traceVisibility()) return;
  try {
    const st = ensureLoaded();
    const indexItem = st.byId.get(id) as Partial<InstructionEntry> | undefined;
    emitTrace('[trace:visibility]', {
      phase,
      id,
      now: new Date().toISOString(),
      indexHas: !!indexItem,
      indexSourceHash: indexItem?.sourceHash,
      indexUpdatedAt: indexItem?.updatedAt,
      serverHash: st.hash,
      listCount: st.list.length,
      sampleIds: st.list.slice(0, 3).map(e => e.id),
      ...extra
    });
  } catch { /* swallow tracing issues */ }
}

export function traceEnvSnapshot(phase: string, extra?: Record<string, unknown>) {
  if (!traceVisibility()) return;
  try {
    const cfg = getRuntimeConfig();
    const instructionsCfg = cfg.instructions;
    const indexCfg = cfg.index;
    emitTrace('[trace:env]', {
      phase,
      pid: process.pid,
      flags: {
        mutationEnabled: cfg.mutation.enabled,
        strictCreate: instructionsCfg.strictCreate,
        canonicalDisable: instructionsCfg.canonicalDisable,
        readRetries: indexCfg.readRetries.attempts,
        readBackoffMs: indexCfg.readRetries.backoffMs,
        requireCategory: instructionsCfg.requireCategory,
        instructionsDir: indexCfg.baseDir
      },
      ...extra
    });
  } catch { /* ignore env tracing errors */ }
}

// ── Shared category normalization (#135) ──────────────────────────
// Extracted from groom handler to eliminate duplication across groom/normalize/repair.

/** Returns true if the category string is considered junk (numeric prefix, single char, case-ticket ID). */
export function isJunkCategory(cat: string): boolean {
  return /^\d/.test(cat) || cat.length <= 1 || /^case-\d{6,}$/.test(cat);
}

/** Normalize a categories array: deduplicate, lowercase, remove junk, remove plural duplicates, sort. */
export function normalizeCategories(cats: unknown[]): string[] {
  let normCats = Array.from(new Set(
    (cats || []).filter(c => typeof c === 'string').map(c => (c as string).toLowerCase())
  ));
  normCats = normCats.filter(c => !isJunkCategory(c));
  normCats = normCats.filter(cat => !(cat.endsWith('s') && normCats.includes(cat.slice(0, -1))));
  return normCats.sort();
}

// ── Shared source hash computation (#135) ─────────────────────────
/** Compute SHA-256 hash of an instruction body. */
export function computeSourceHash(body: string): string {
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

// ── Shared version bump logic (#135) ──────────────────────────────
/** Bump a semver version string. Returns the new version string. */
export function bumpVersion(currentVersion: string | undefined, bump: 'patch' | 'minor' | 'major'): string {
  const parts = (currentVersion || '1.0.0').split('.').map(n => parseInt(n || '0', 10));
  while (parts.length < 3) parts.push(0);
  if (bump === 'major') { parts[0]++; parts[1] = 0; parts[2] = 0; }
  else if (bump === 'minor') { parts[1]++; parts[2] = 0; }
  else if (bump === 'patch') { parts[2]++; }
  return parts.join('.');
}

// ── Shared changelog entry creation (#135) ────────────────────────
/** Create a changelog entry object for an instruction version change. */
export function createChangeLogEntry(version: string, summary: string): { version: string; changedAt: string; summary: string } {
  return { version, changedAt: new Date().toISOString(), summary };
}

// ── Shared input-side category normalization (#135) ──────────────
/**
 * Normalize categories supplied as input to add/import handlers:
 * filter to non-empty strings, lowercase, deduplicate, and sort.
 *
 * Distinct from {@link normalizeCategories} (used by groom), which also
 * strips junk patterns and plural duplicates.
 */
export function normalizeInputCategories(cats: unknown): string[] {
  const arr = Array.isArray(cats) ? cats : [];
  return Array.from(new Set(
    arr
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      .map(c => c.toLowerCase())
  )).sort();
}

// ── Shared changelog repair (#135) ────────────────────────────────
type ChangeLogArr = NonNullable<InstructionEntry['changeLog']>;

export interface RepairChangeLogOptions {
  /** Final/expected version that the last entry must end with. */
  finalVersion: string;
  /** ISO timestamp to use as `now`. */
  now: string;
  /** Fallback entry pushed when the supplied changeLog is empty/invalid. */
  fallback: { version: string; changedAt: string; summary: string };
  /** Summary to use when appending a trailing entry to reach finalVersion. */
  trailingSummary: string;
}

/**
 * Repair a changelog array: drop malformed entries, ensure non-empty,
 * and ensure the last entry's version matches `finalVersion`.
 *
 * Used by the overwrite/merge and new-entry paths in `index_add` plus any
 * other handler that needs to normalize a user-supplied changeLog.
 */
export function repairChangeLog(cl: unknown, options: RepairChangeLogOptions): ChangeLogArr {
  interface CLRaw { version?: unknown; changedAt?: unknown; summary?: unknown }
  const out: ChangeLogArr = [];
  if (Array.isArray(cl)) {
    for (const entry of cl) {
      if (!entry || typeof entry !== 'object') continue;
      const { version: v, changedAt: ca, summary: sum } = entry as CLRaw;
      if (typeof v === 'string' && v.trim() && typeof sum === 'string' && sum.trim()) {
        const caIso = typeof ca === 'string' && /T/.test(ca) ? ca : options.now;
        out.push({ version: v.trim(), changedAt: caIso, summary: sum.trim() });
      }
    }
  }
  if (!out.length) {
    out.push({ ...options.fallback });
  }
  const lastVer = out[out.length - 1].version;
  if (lastVer !== options.finalVersion) {
    out.push({ version: options.finalVersion, changedAt: options.now, summary: options.trailingSummary });
  }
  return out;
}

// ── Shared governance key merge (#135) ────────────────────────────
/** Governance keys merged from input into the entry by `index_add`.
 * `riskScore` and `reviewIntervalDays` are listed here because the existing-entry
 * branch builds `base` from a `{...existing}` spread; without them a caller value
 * was accepted and then discarded on overwrite (#492).
 */
export const ADD_GOVERNANCE_KEYS: readonly (keyof ImportEntry)[] = [
  'version', 'owner', 'status', 'priorityTier', 'classification',
  'lastReviewedAt', 'nextReviewDue', 'semanticSummary', 'contentType', 'extensions',
  'riskScore', 'reviewIntervalDays'
] as const;

/** Governance keys merged from input into the entry by `index_import`.
 * Differs from {@link ADD_GOVERNANCE_KEYS} by also including `changeLog`,
 * since import accepts changeLog directly without invoking repair logic.
 */
export const IMPORT_GOVERNANCE_KEYS: readonly (keyof ImportEntry)[] = [
  'version', 'owner', 'status', 'priorityTier', 'classification',
  'lastReviewedAt', 'nextReviewDue', 'changeLog', 'semanticSummary',
  'contentType', 'extensions', 'riskScore', 'reviewIntervalDays'
] as const;

/** Copy defined governance fields from `source` into `target` for the given keys. */
export function applyGovernanceKeys(
  target: InstructionEntry,
  source: ImportEntry,
  keys: readonly (keyof ImportEntry)[]
): void {
  const t = target as unknown as Record<string, unknown>;
  for (const k of keys) {
    const v = source[k];
    if (v !== undefined) {
      t[k as string] = v as unknown;
    }
  }
}

// ── Link validation (spec 511, V1/V2) ──────────────────────────────

const ORDERED_RELS = new Set<LinkRel>(['prerequisite', 'sequel', 'part-of']);

export interface LinkValidationResult {
  links: InstructionLink[];
  warnings: string[];
  error?: string;
}

export function validateLinks(
  id: string,
  rawLinks: unknown,
  byId: ReadonlyMap<string, unknown>,
): LinkValidationResult {
  const warnings: string[] = [];
  if (rawLinks === undefined || rawLinks === null) {
    return { links: [], warnings };
  }
  if (!Array.isArray(rawLinks)) {
    return { links: [], warnings, error: 'links must be an array' };
  }
  if (rawLinks.length > 25) {
    return { links: [], warnings, error: `links exceeds maximum of 25 items (got ${rawLinks.length})` };
  }

  const seen = new Set<string>();
  const deduped: InstructionLink[] = [];

  for (const raw of rawLinks) {
    if (!raw || typeof raw !== 'object') continue;
    const link = raw as { target?: unknown; rel?: unknown; label?: unknown };
    if (typeof link.target !== 'string' || !link.target) continue;

    const rel: LinkRel = (typeof link.rel === 'string' && (LINK_RELS as readonly string[]).includes(link.rel))
      ? link.rel as LinkRel
      : 'related';

    if (link.target === id) {
      return { links: [], warnings, error: `self-referencing link: target "${link.target}" is the entry's own id` };
    }

    const key = `${link.target}:${rel}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!byId.has(link.target)) {
      warnings.push(`dead-link: target "${link.target}" not found in active index`);
    }

    const label = typeof link.label === 'string' ? link.label.slice(0, 120) : undefined;
    deduped.push({ target: link.target, rel, ...(label ? { label } : {}) });
  }

  // Cycle detection for ordered rels
  for (const link of deduped) {
    if (!ORDERED_RELS.has(link.rel!)) continue;
    const cyclePath = detectCycle(id, link.target, link.rel!, byId);
    if (cyclePath) {
      return {
        links: [],
        warnings,
        error: `cycle detected for rel "${link.rel}": ${cyclePath.join(' → ')} → ${id}`,
      };
    }
  }

  return { links: deduped, warnings };
}

function detectCycle(
  sourceId: string,
  startTarget: string,
  rel: LinkRel,
  byId: ReadonlyMap<string, unknown>,
): string[] | null {
  const visited = new Set<string>();
  const stack: Array<{ id: string; path: string[] }> = [
    { id: startTarget, path: [startTarget] },
  ];

  while (stack.length > 0) {
    const { id: currentId, path } = stack.pop()!;
    if (currentId === sourceId) return path;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const entry = byId.get(currentId) as { links?: InstructionLink[] } | undefined;
    if (!entry?.links) continue;

    for (const link of entry.links) {
      if (link.rel === rel && !visited.has(link.target)) {
        stack.push({ id: link.target, path: [...path, link.target] });
      }
    }
  }

  return null;
}

export {};
