/**
 * JsonFileStore — JSON-file-per-instruction storage backend.
 *
 * Wraps the existing file-based storage pattern: each instruction is a
 * separate .json file in a directory. This is the default backend.
 *
 * Implements IInstructionStore for the storage abstraction layer.
 */

import fs from 'fs';
import path from 'path';
import { InstructionEntry } from '../../models/instruction.js';
import { computeGovernanceHashFromEntries, computeArchiveHashFromEntries } from './hashUtils.js';
import { atomicCreateJson, atomicWriteJson } from '../atomicFs.js';
import type {
  IInstructionStore,
  ListOptions,
  QueryOptions,
  ScopedListOptions,
  SearchOptions,
  SearchResult,
  LoadResult,
  ArchiveMeta,
  ListArchivedOpts,
  RestoreMode,
} from './types.js';

export class JsonFileStore implements IInstructionStore {
  private readonly dir: string;
  private cache: Map<string, InstructionEntry> = new Map();
  private loaded = false;

  /**
   * @param dir - Directory containing instruction .json files.
   */
  constructor(dir: string) {
    this.dir = dir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  load(): LoadResult {
    const errors: { file: string; error: string }[] = [];
    const entries: InstructionEntry[] = [];
    let scanned = 0;
    let skipped = 0;

    // Active loader skips:
    //   - non-.json files
    //   - leading '_' or '.' names (covers .archive/, .backups/, .tmp/, etc.)
    // readdirSync is non-recursive, so subdirectory contents are never visited.
    const files = fs.readdirSync(this.dir).filter(f =>
      f.endsWith('.json') && !f.startsWith('_') && !f.startsWith('.')
    );
    scanned = files.length;

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(this.dir, file), 'utf-8');
        const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));

        // Handle arrays (some files contain instruction arrays)
        const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          const entry = item as InstructionEntry;
          if (!entry.id || !entry.title || !entry.body) {
            skipped++;
            continue;
          }
          entries.push(entry);
        }
      } catch (err) {
        skipped++;
        errors.push({ file, error: err instanceof Error ? err.message : 'Unknown parse error' });
      }
    }

    // Deduplicate by ID (last-write-wins)
    const byId = new Map<string, InstructionEntry>();
    for (const e of entries) {
      byId.set(e.id, e);
    }
    const deduped = Array.from(byId.values());

    this.cache = byId;
    this.loaded = true;

    return {
      entries: deduped,
      hash: computeGovernanceHashFromEntries(deduped),
      errors,
      debug: { scanned, accepted: deduped.length, skipped },
      summary: {
        scanned,
        accepted: deduped.length,
        skipped,
        reasons: errors.length > 0 ? { 'parse-error': errors.length } : {},
      },
    };
  }

  close(): void {
    this.cache.clear();
    this.loaded = false;
  }

  // ── CRUD ───────────────────────────────────────────────────────────

  get(id: string): InstructionEntry | null {
    this.ensureLoaded();
    return this.cache.get(id) ?? null;
  }

  write(entry: InstructionEntry, opts?: { createOnly?: boolean }): void {
    const filePath = path.join(this.dir, `${entry.id}.json`);
    if (opts?.createOnly) {
      atomicCreateJson(filePath, entry);
    } else {
      atomicWriteJson(filePath, entry);
    }

    // Update in-memory cache
    this.cache.set(entry.id, entry);
    this.loaded = true;
  }

  remove(id: string): void {
    const filePath = path.join(this.dir, `${id}.json`);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // No-op on failure (file may already be gone)
    }
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

    // Pagination
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

  // ── Integrity ──────────────────────────────────────────────────────

  computeHash(): string {
    this.ensureLoaded();
    return computeGovernanceHashFromEntries(Array.from(this.cache.values()));
  }

  count(): number {
    this.ensureLoaded();
    return this.cache.size;
  }

  // ── Archive Lifecycle ──────────────────────────────────────────────

  /**
   * Path to the segregated archive directory. Active `load()` skips any
   * subdirectory whose basename starts with `.`, so `.archive/` is invisible
   * to active queries by construction.
   */
  private archiveDir(): string {
    return path.join(this.dir, '.archive');
  }

  private archiveFilePath(id: string): string {
    return path.join(this.archiveDir(), `${id}.json`);
  }

  private ensureArchiveDir(): void {
    const dir = this.archiveDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private readArchiveFile(id: string): InstructionEntry | null {
    const file = this.archiveFilePath(id);
    if (!fs.existsSync(file)) return null;
    try {
      const raw = fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
      const parsed = JSON.parse(raw) as InstructionEntry;
      if (!parsed.id || !parsed.title || !parsed.body) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  archive(id: string, meta?: ArchiveMeta): InstructionEntry {
    this.ensureLoaded();
    const active = this.cache.get(id);
    if (!active) {
      throw new Error(`archive: no active entry with id "${id}"`);
    }

    const archived: InstructionEntry = {
      ...active,
      archivedAt: meta?.archivedAt ?? new Date().toISOString(),
      archivedBy: meta?.archivedBy,
      archiveReason: meta?.archiveReason,
      archiveSource: meta?.archiveSource,
      restoreEligible: meta?.restoreEligible ?? true,
    };

    this.ensureArchiveDir();
    const archivePath = this.archiveFilePath(id);
    // Step 1: atomic write of archive copy (temp + rename).
    atomicWriteJson(archivePath, archived);

    // Step 2: unlink the active file. If this fails, roll back the archive
    // write so we never leave the id present in both stores.
    const activePath = path.join(this.dir, `${id}.json`);
    try {
      if (fs.existsSync(activePath)) {
        fs.unlinkSync(activePath);
      }
    } catch (err) {
      // Rollback: remove the archive copy we just created.
      try { if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath); } catch { /* swallow */ }
      throw err instanceof Error ? err : new Error('archive: failed to remove active file');
    }

    this.cache.delete(id);
    return archived;
  }

  restore(id: string, mode: RestoreMode = 'reject'): InstructionEntry {
    this.ensureLoaded();
    const archived = this.readArchiveFile(id);
    if (!archived) {
      throw new Error(`restore: no archived entry with id "${id}"`);
    }
    if (archived.restoreEligible === false) {
      throw new Error(`restore: entry "${id}" is marked restoreEligible=false (ineligible)`);
    }
    const activeExists = this.cache.has(id) || fs.existsSync(path.join(this.dir, `${id}.json`));
    if (activeExists && mode !== 'overwrite') {
      throw new Error(`restore: active entry with id "${id}" already exists (collision)`);
    }

    // Strip archive metadata from restored payload.
    const restored: InstructionEntry = { ...archived };
    delete restored.archivedAt;
    delete restored.archivedBy;
    delete restored.archiveReason;
    delete restored.archiveSource;
    delete restored.restoreEligible;

    const activePath = path.join(this.dir, `${id}.json`);
    const archivePath = this.archiveFilePath(id);

    // Step 1: write active file (atomic).
    atomicWriteJson(activePath, restored);

    // Step 2: remove archive file; on failure roll back active write.
    try {
      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath);
      }
    } catch (err) {
      // Rollback: remove the active file we just wrote (only if no prior
      // active entry existed — overwrite mode intentionally replaces).
      if (mode !== 'overwrite') {
        try { if (fs.existsSync(activePath)) fs.unlinkSync(activePath); } catch { /* swallow */ }
      }
      throw err instanceof Error ? err : new Error('restore: failed to remove archive file');
    }

    this.cache.set(id, restored);
    return restored;
  }

  purge(id: string): void {
    const file = this.archiveFilePath(id);
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // No-op (mirrors remove() semantics).
    }
  }

  getArchived(id: string): InstructionEntry | null {
    return this.readArchiveFile(id);
  }

  listArchived(opts?: ListArchivedOpts): InstructionEntry[] {
    const dir = this.archiveDir();
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('.') && !f.startsWith('_'));
    const out: InstructionEntry[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf-8').replace(/^\uFEFF/, '');
        const entry = JSON.parse(raw) as InstructionEntry;
        if (!entry.id || !entry.title || !entry.body) continue;
        out.push(entry);
      } catch {
        // skip unreadable
      }
    }

    let result = out;
    if (opts?.reason) result = result.filter(e => e.archiveReason === opts.reason);
    if (opts?.source) result = result.filter(e => e.archiveSource === opts.source);
    if (opts?.archivedBy) result = result.filter(e => e.archivedBy === opts.archivedBy);
    if (opts?.restoreEligible !== undefined) {
      result = result.filter(e => (e.restoreEligible ?? true) === opts.restoreEligible);
    }

    // Stable ordering: by archivedAt asc, then id asc.
    result.sort((a, b) => {
      const ta = a.archivedAt ?? '';
      const tb = b.archivedAt ?? '';
      if (ta !== tb) return ta.localeCompare(tb);
      return a.id.localeCompare(b.id);
    });

    if (opts?.offset) result = result.slice(opts.offset);
    if (opts?.limit !== undefined) result = result.slice(0, opts.limit);
    return result;
  }

  countArchived(): number {
    const dir = this.archiveDir();
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('.') && !f.startsWith('_')).length;
  }

  computeArchiveHash(): string {
    return computeArchiveHashFromEntries(this.listArchived());
  }

  // ── Internal ───────────────────────────────────────────────────────

  private ensureLoaded(): void {
    if (!this.loaded) {
      this.load();
    }
  }
}
