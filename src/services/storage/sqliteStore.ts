/**
 * SqliteStore — SQLite storage backend using Node.js built-in node:sqlite.
 *
 * ⚠️  EXPERIMENTAL — LIMITED TESTING PERFORMED.
 * This backend is behind the INDEX_SERVER_STORAGE_BACKEND=sqlite feature flag
 * and should NOT be used in production without thorough validation.
 * Data loss, migration issues, or compatibility problems may occur.
 *
 * Uses DatabaseSync (synchronous API) — zero third-party dependencies.
 * Requires Node.js >= 22.5.0.
 *
 * Implements IInstructionStore for the storage abstraction layer.
 */

import { DatabaseSync } from 'node:sqlite';
import { InstructionEntry } from '../../models/instruction.js';
import { computeGovernanceHashFromEntries } from './hashUtils.js';
import { INSTRUCTIONS_DDL, FTS5_DDL, PRAGMAS, SCHEMA_VERSION } from './sqliteSchema.js';
import type {
  IInstructionStore,
  ListOptions,
  QueryOptions,
  ScopedListOptions,
  SearchOptions,
  SearchResult,
  LoadResult,
} from './types.js';

// ── Column Mapping ───────────────────────────────────────────────────────────

/** Map DB row (snake_case) to InstructionEntry (camelCase). */
function rowToEntry(row: Record<string, unknown>): InstructionEntry {
  return {
    id: row.id as string,
    title: row.title as string,
    body: row.body as string,
    rationale: row.rationale as string | undefined,
    priority: row.priority as number,
    audience: row.audience as InstructionEntry['audience'],
    requirement: row.requirement as InstructionEntry['requirement'],
    categories: safeJsonParse(row.categories as string, []),
    contentType: (row.content_type as InstructionEntry['contentType']) ?? 'instruction',
    primaryCategory: row.primary_category as string | undefined,
    sourceHash: row.source_hash as string,
    schemaVersion: row.schema_version as string,
    deprecatedBy: row.deprecated_by as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    version: row.version as string | undefined,
    status: row.status as InstructionEntry['status'],
    owner: row.owner as string | undefined,
    priorityTier: row.priority_tier as InstructionEntry['priorityTier'],
    classification: row.classification as InstructionEntry['classification'],
    lastReviewedAt: row.last_reviewed_at as string | undefined,
    nextReviewDue: row.next_review_due as string | undefined,
    reviewIntervalDays: row.review_interval_days as number | undefined,
    changeLog: safeJsonParse(row.change_log as string, undefined),
    supersedes: row.supersedes as string | undefined,
    archivedAt: row.archived_at as string | undefined,
    workspaceId: row.workspace_id as string | undefined,
    userId: row.user_id as string | undefined,
    teamIds: safeJsonParse(row.team_ids as string, undefined),
    semanticSummary: row.semantic_summary as string | undefined,
    createdByAgent: row.created_by_agent as string | undefined,
    sourceWorkspace: row.source_workspace as string | undefined,
    extensions: safeJsonParse(row.extensions as string, undefined),
    riskScore: row.risk_score as number | undefined,
    usageCount: row.usage_count as number | undefined,
    firstSeenTs: row.first_seen_ts as string | undefined,
    lastUsedAt: row.last_used_at as string | undefined,
  };
}

/** Safely parse a JSON string, returning fallback on failure. */
function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Strip undefined values from entry to avoid SQLite binding issues. */
function val(v: unknown): unknown {
  return v === undefined ? null : v;
}

function isDuplicateColumnError(error: unknown, column: string): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  const columnName = column.toLowerCase();
  return (message.includes('duplicate column') || message.includes('duplicate column name')) && message.includes(columnName);
}

// ── SqliteStore ──────────────────────────────────────────────────────────────

export class SqliteStore implements IInstructionStore {
  private db: DatabaseSync;
  private loaded = false;
  private cache: Map<string, InstructionEntry> = new Map();

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(PRAGMAS);
    this.db.exec(INSTRUCTIONS_DDL);
    this.ensureColumn('instructions', 'extensions', 'TEXT');
    // FTS5 for full-text search (with content sync triggers)
    try { this.db.exec(FTS5_DDL); } catch { /* FTS5 may already exist */ }
    // Stamp schema version if not present
    const meta = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get('schema_version');
    if (!meta) {
      this.db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('schema_version', SCHEMA_VERSION);
    }
  }

  private ensureColumn(table: string, column: string, ddl: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
    if (rows.some(row => row.name === column)) return;
    try {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    } catch (error) {
      if (!isDuplicateColumnError(error, column)) throw error;
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  load(): LoadResult {
    const rows = this.db.prepare('SELECT * FROM instructions').all();
    const entries: InstructionEntry[] = [];
    const errors: { file: string; error: string }[] = [];

    for (const row of rows) {
      try {
        entries.push(rowToEntry(row));
      } catch (err) {
        errors.push({
          file: (row.id as string) ?? 'unknown',
          error: err instanceof Error ? err.message : 'Row parse error',
        });
      }
    }

    this.cache.clear();
    for (const e of entries) {
      this.cache.set(e.id, e);
    }
    this.loaded = true;

    return {
      entries,
      hash: computeGovernanceHashFromEntries(entries),
      errors,
      debug: { scanned: rows.length, accepted: entries.length, skipped: errors.length },
      summary: {
        scanned: rows.length,
        accepted: entries.length,
        skipped: errors.length,
        reasons: errors.length > 0 ? { 'row-parse-error': errors.length } : {},
      },
    };
  }

  close(): void {
    this.cache.clear();
    this.loaded = false;
    this.db.close();
  }

  // ── CRUD ───────────────────────────────────────────────────────────

  get(id: string): InstructionEntry | null {
    this.ensureLoaded();
    return this.cache.get(id) ?? null;
  }

  write(entry: InstructionEntry): void {
    const sql = `INSERT OR REPLACE INTO instructions (
      id, title, body, rationale, priority, audience, requirement,
      categories, content_type, primary_category, source_hash,
      schema_version, deprecated_by, created_at, updated_at,
      version, status, owner, priority_tier, classification,
      last_reviewed_at, next_review_due, review_interval_days,
      change_log, supersedes, archived_at, workspace_id, user_id,
      team_ids, semantic_summary, created_by_agent, source_workspace,
      extensions,
      risk_score, usage_count, first_seen_ts, last_used_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?
    )`;

    this.db.prepare(sql).run(
      entry.id,
      entry.title,
      entry.body,
      val(entry.rationale),
      val(entry.priority) ?? 0,
      val(entry.audience) ?? 'all',
      val(entry.requirement) ?? 'may',
      JSON.stringify(entry.categories ?? []),
      val(entry.contentType) ?? 'instruction',
      val(entry.primaryCategory),
      entry.sourceHash ?? '',
      entry.schemaVersion ?? '4',
      val(entry.deprecatedBy),
      val(entry.createdAt) ?? new Date().toISOString(),
      val(entry.updatedAt) ?? new Date().toISOString(),
      val(entry.version),
      val(entry.status),
      val(entry.owner),
      val(entry.priorityTier),
      val(entry.classification),
      val(entry.lastReviewedAt),
      val(entry.nextReviewDue),
      val(entry.reviewIntervalDays),
      JSON.stringify(entry.changeLog ?? []),
      val(entry.supersedes),
      val(entry.archivedAt),
      val(entry.workspaceId),
      val(entry.userId),
      JSON.stringify(entry.teamIds ?? []),
      val(entry.semanticSummary),
      val(entry.createdByAgent),
      val(entry.sourceWorkspace),
      entry.extensions === undefined ? null : JSON.stringify(entry.extensions),
      val(entry.riskScore),
      val(entry.usageCount) ?? 0,
      val(entry.firstSeenTs),
      val(entry.lastUsedAt),
    );

    // Update in-memory cache
    this.cache.set(entry.id, entry);
    this.loaded = true;
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM instructions WHERE id = ?').run(id);
    this.cache.delete(id);
  }

  // ── Queries ────────────────────────────────────────────────────────

  list(opts?: ListOptions): InstructionEntry[] {
    this.ensureLoaded();
    let result = Array.from(this.cache.values());

    if (opts?.category) {
      result = result.filter(e => e.categories?.includes(opts.category!));
    }
    if (opts?.contentType) {
      result = result.filter(e => e.contentType === opts.contentType);
    }

    return result;
  }

  query(opts: QueryOptions): InstructionEntry[] {
    this.ensureLoaded();
    let result = Array.from(this.cache.values());

    if (opts.text) {
      const lower = opts.text.toLowerCase();
      result = result.filter(e =>
        e.title.toLowerCase().includes(lower) ||
        e.body.toLowerCase().includes(lower) ||
        (e.semanticSummary && e.semanticSummary.toLowerCase().includes(lower))
      );
    }

    if (opts.categoriesAny?.length) {
      const set = new Set(opts.categoriesAny);
      result = result.filter(e => e.categories?.some(c => set.has(c)));
    }

    if (opts.categoriesAll?.length) {
      result = result.filter(e =>
        opts.categoriesAll!.every(c => e.categories?.includes(c))
      );
    }

    if (opts.excludeCategories?.length) {
      const excl = new Set(opts.excludeCategories);
      result = result.filter(e => !e.categories?.some(c => excl.has(c)));
    }

    if (opts.contentType) {
      result = result.filter(e => e.contentType === opts.contentType);
    }

    if (opts.priorityMin !== undefined) {
      result = result.filter(e => e.priority >= opts.priorityMin!);
    }

    if (opts.priorityMax !== undefined) {
      result = result.filter(e => e.priority <= opts.priorityMax!);
    }

    if (opts.priorityTiers?.length) {
      const tiers = new Set(opts.priorityTiers);
      result = result.filter(e => e.priorityTier && tiers.has(e.priorityTier));
    }

    if (opts.requirements?.length) {
      const reqs = new Set(opts.requirements);
      result = result.filter(e => reqs.has(e.requirement));
    }

    if (opts.offset) {
      result = result.slice(opts.offset);
    }
    if (opts.limit) {
      result = result.slice(0, opts.limit);
    }

    return result;
  }

  listScoped(opts: ScopedListOptions): InstructionEntry[] {
    this.ensureLoaded();
    let result = Array.from(this.cache.values());

    if (opts.userId) {
      result = result.filter(e => e.userId === opts.userId || e.audience === 'all');
    }
    if (opts.workspaceId) {
      result = result.filter(e => e.workspaceId === opts.workspaceId || e.audience === 'all');
    }
    if (opts.teamIds?.length) {
      const teams = new Set(opts.teamIds);
      result = result.filter(e =>
        e.audience === 'all' ||
        e.teamIds?.some(t => teams.has(t))
      );
    }

    return result;
  }

  search(opts: SearchOptions): SearchResult[] {
    this.ensureLoaded();
    const results: SearchResult[] = [];

    for (const entry of this.cache.values()) {
      let score = 0;
      const titleLower = entry.title.toLowerCase();
      const bodyLower = entry.body.toLowerCase();
      const catStr = (entry.categories ?? []).join(' ').toLowerCase();

      for (const kw of opts.keywords) {
        const kwLower = opts.caseSensitive ? kw : kw.toLowerCase();
        const title = opts.caseSensitive ? entry.title : titleLower;
        const body = opts.caseSensitive ? entry.body : bodyLower;

        if (title.includes(kwLower)) score += 3;
        if (body.includes(kwLower)) score += 1;
        if (opts.includeCategories && catStr.includes(kwLower)) score += 2;
      }

      if (score > 0) {
        results.push({ id: entry.id, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    if (opts.limit) {
      return results.slice(0, opts.limit);
    }
    return results;
  }

  categories(): Map<string, number> {
    this.ensureLoaded();
    const counts = new Map<string, number>();
    for (const entry of this.cache.values()) {
      for (const cat of entry.categories ?? []) {
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      }
    }
    return counts;
  }

  // ── FTS5 Search ────────────────────────────────────────────────────

  /**
   * Full-text search using FTS5 with BM25 ranking.
   * More efficient than in-memory scan for large instruction sets.
   * Falls back to in-memory search if FTS5 is unavailable.
   */
  searchFts(opts: SearchOptions): SearchResult[] {
    this.ensureLoaded();
    try {
      // Build FTS5 MATCH query: OR all keywords
      const matchTerms = opts.keywords
        .map(kw => `"${kw.replace(/"/g, '""')}"`)
        .join(' OR ');

      const sql = `
        SELECT id, bm25(instructions_fts, 0, 10.0, 5.0, 1.0) as rank
        FROM instructions_fts
        WHERE instructions_fts MATCH ?
        ORDER BY rank
        ${opts.limit ? 'LIMIT ?' : ''}
      `;

      const params: unknown[] = [matchTerms];
      if (opts.limit) params.push(opts.limit);

      const rows = this.db.prepare(sql).all(...params);
      return rows.map(row => {
        const r = row as Record<string, unknown>;
        return {
          id: r.id as string,
          // BM25 returns negative scores (lower = better), negate for positive ranking
          score: -(r.rank as number),
        };
      });
    } catch {
      // FTS5 unavailable — fall back to in-memory search
      return this.search(opts);
    }
  }

  // ── Integrity ──────────────────────────────────────────────────────

  computeHash(): string {
    this.ensureLoaded();
    return computeGovernanceHashFromEntries(Array.from(this.cache.values()));
  }

  count(): number {
    this.ensureLoaded();
    return this.cache.size;
  }

  // ── Internal ───────────────────────────────────────────────────────

  private ensureLoaded(): void {
    if (!this.loaded) {
      this.load();
    }
  }
}
