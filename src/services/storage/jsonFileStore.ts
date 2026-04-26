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
import { computeGovernanceHashFromEntries } from './hashUtils.js';
import { atomicCreateJson, atomicWriteJson } from '../atomicFs.js';
import type {
  IInstructionStore,
  ListOptions,
  QueryOptions,
  ScopedListOptions,
  SearchOptions,
  SearchResult,
  LoadResult,
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

  // ── Internal ───────────────────────────────────────────────────────

  private ensureLoaded(): void {
    if (!this.loaded) {
      this.load();
    }
  }
}
