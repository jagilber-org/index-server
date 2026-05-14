/**
 * JsonEmbeddingStore — IEmbeddingStore backed by a flat JSON file.
 *
 * Wraps the existing embeddings.json disk cache format.
 * Search is brute-force cosine similarity (no indexing).
 */

import fs from 'fs';
import path from 'path';
import type { IEmbeddingStore, EmbeddingCacheData, EmbeddingSearchResult } from './types.js';

/**
 * Cosine similarity between two numeric arrays.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export class JsonEmbeddingStore implements IEmbeddingStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  load(): EmbeddingCacheData | null {
    try {
      if (!fs.existsSync(this.filePath)) return null;
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw);
      // Backwards-compat: older caches used 'catalogHash'
      if (data && typeof data.catalogHash === 'string' && typeof data.indexHash !== 'string') {
        data.indexHash = data.catalogHash;
        delete data.catalogHash;
      }
      if (!data || typeof data.indexHash !== 'string' || typeof data.embeddings !== 'object') return null;
      return data as EmbeddingCacheData;
    } catch {
      return null;
    }
  }

  save(data: EmbeddingCacheData): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(data), 'utf-8');
  }

  search(queryVector: Float32Array, limit: number): EmbeddingSearchResult[] {
    if (limit <= 0) return [];
    const cached = this.load();
    if (!cached) return [];

    const query = Array.from(queryVector);
    const results: EmbeddingSearchResult[] = [];

    for (const [id, vec] of Object.entries(cached.embeddings)) {
      const similarity = cosineSimilarity(query, vec);
      // Distance = 1 - similarity (lower is closer)
      results.push({ id, distance: 1 - similarity });
    }

    results.sort((a, b) => a.distance - b.distance);
    return results.slice(0, limit);
  }

  close(): void {
    // No resources to release for file-based store
  }

  evict(id: string): void {
    const data = this.load();
    if (!data) return;
    let changed = false;
    if (data.embeddings && Object.prototype.hasOwnProperty.call(data.embeddings, id)) {
      delete data.embeddings[id];
      changed = true;
    }
    if (data.entryHashes && Object.prototype.hasOwnProperty.call(data.entryHashes, id)) {
      delete data.entryHashes[id];
      changed = true;
    }
    if (changed) this.save(data);
  }

  markStale(id: string): void {
    const data = this.load();
    if (!data || !data.entryHashes) return;
    if (Object.prototype.hasOwnProperty.call(data.entryHashes, id)) {
      delete data.entryHashes[id];
      this.save(data);
    }
  }
}
