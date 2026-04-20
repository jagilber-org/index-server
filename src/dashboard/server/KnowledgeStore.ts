/**
 * KnowledgeStore - In-memory + file-backed key-value store
 * for cross-repo agent performance insights.
 *
 * Persists to {dataDir}/knowledge-store.json.
 * Requested by mcp-agent-manager (feedback d664a9239632f287).
 */

import fs from 'fs';
import path from 'path';
import { getRuntimeConfig } from '../../config/runtimeConfig';

export interface KnowledgeEntry {
  key: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

class KnowledgeStore {
  private entries: Map<string, KnowledgeEntry> = new Map();
  private filePath: string;

  constructor(dataDir?: string) {
    const dir = dataDir || getRuntimeConfig().index?.baseDir || path.join(process.cwd(), 'data');
    this.filePath = path.join(dir, 'knowledge-store.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (Array.isArray(raw)) {
          for (const entry of raw) {
            if (entry.key) this.entries.set(entry.key, entry);
          }
        }
      }
    } catch { /* ignore corrupt/missing file */ }
  }

  private saveToDisk(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(Array.from(this.entries.values()), null, 2));
    } catch { /* ignore write errors */ }
  }

  upsert(key: string, content: string, metadata: Record<string, unknown> = {}): KnowledgeEntry {
    const now = new Date().toISOString();
    const existing = this.entries.get(key);
    const entry: KnowledgeEntry = {
      key,
      content,
      metadata: { ...metadata },
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this.entries.set(key, entry);
    this.saveToDisk();
    return entry;
  }

  get(key: string): KnowledgeEntry | undefined {
    return this.entries.get(key);
  }

  search(query: string, options?: { category?: string; limit?: number }): KnowledgeEntry[] {
    const q = query.toLowerCase();
    const limit = options?.limit || 20;
    const results: KnowledgeEntry[] = [];

    for (const entry of this.entries.values()) {
      if (results.length >= limit) break;
      if (options?.category && entry.metadata?.category !== options.category) continue;
      const searchable = [entry.key, entry.content, ...Object.values(entry.metadata).map(v => String(v))].join(' ').toLowerCase();
      if (searchable.includes(q)) results.push(entry);
    }
    return results;
  }

  delete(key: string): boolean {
    const existed = this.entries.delete(key);
    if (existed) this.saveToDisk();
    return existed;
  }

  count(): number {
    return this.entries.size;
  }
}

let instance: KnowledgeStore | null = null;

export function getKnowledgeStore(): KnowledgeStore {
  if (!instance) instance = new KnowledgeStore();
  return instance;
}

/** Reset singleton — for tests only */
export function resetKnowledgeStore(): void {
  instance = null;
}

/** Create a standalone store with custom data dir — for tests */
export function createKnowledgeStore(dataDir: string): KnowledgeStore {
  return new KnowledgeStore(dataDir);
}
