/**
 * Embeddings Routes
 * Route: GET /embeddings/projection — PCA-project embeddings to 2D for visualization.
 */

import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import { getRuntimeConfig } from '../../../config/runtimeConfig.js';
import { getInstructionEmbeddings, checkModelReadiness } from '../../../services/embeddingService.js';
import type { IEmbeddingStore } from '../../../services/storage/types.js';
import type { IndexLocals } from '../middleware/ensureLoadedMiddleware.js';
import { dashboardAdminAuth } from './adminAuth.js';

interface EmbeddingsFile {
  indexHash: string;
  modelName: string;
  embeddings: Record<string, number[]>;
}

interface ProjectedPoint {
  id: string;
  x: number;
  y: number;
  category: string;
  norm: number;
}

interface SimilarPair {
  a: string;
  b: string;
  similarity: number;
}

// ---------------------------------------------------------------------------
// Category derivation from instruction ID (shared rules)
// ---------------------------------------------------------------------------

import { deriveCategory } from '../../../services/categoryRules.js';

// ---------------------------------------------------------------------------
// PCA via power iteration (no dependencies)
// ---------------------------------------------------------------------------

function mean(vectors: number[][]): number[] {
  const n = vectors.length;
  const d = vectors[0].length;
  const m = new Array<number>(d).fill(0);
  for (const v of vectors) for (let i = 0; i < d; i++) m[i] += v[i];
  for (let i = 0; i < d; i++) m[i] /= n;
  return m;
}

function subtract(a: number[], b: number[]): number[] {
  return a.map((v, i) => v - b[i]);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(v: number[]): number {
  return Math.sqrt(dot(v, v));
}

function scale(v: number[], s: number): number[] {
  return v.map(x => x * s);
}

/** Compute the top principal component via power iteration. */
function powerIteration(centered: number[][], dims: number, iterations = 100): number[] {
  // random init
  let pc = Array.from({ length: dims }, () => Math.random() - 0.5);
  const n = norm(pc);
  if (n > 0) pc = scale(pc, 1 / n);

  for (let iter = 0; iter < iterations; iter++) {
    const newPc = new Array<number>(dims).fill(0);
    for (const row of centered) {
      const d = dot(row, pc);
      for (let j = 0; j < dims; j++) newPc[j] += d * row[j];
    }
    const len = norm(newPc);
    if (len === 0) break;
    pc = scale(newPc, 1 / len);
  }
  return pc;
}

/** Deflate: remove component along given direction */
function deflate(centered: number[][], pc: number[]): number[][] {
  return centered.map(row => {
    const proj = dot(row, pc);
    return row.map((v, i) => v - proj * pc[i]);
  });
}

/** PCA project to 2D */
function pcaProject(vectors: number[][]): { x: number; y: number }[] {
  if (vectors.length === 0) return [];
  const dims = vectors[0].length;

  if (vectors.length === 1) {
    return [{ x: 0, y: 0 }];
  }

  const mu = mean(vectors);
  let centered = vectors.map(v => subtract(v, mu));

  const pc1 = powerIteration(centered, dims);
  centered = deflate(centered, pc1);
  const pc2 = powerIteration(centered, dims);

  return vectors.map(v => {
    const c = subtract(v, mu);
    return { x: dot(c, pc1), y: dot(c, pc2) };
  });
}

// ---------------------------------------------------------------------------
// Cosine similarity stats
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

function computeStats(
  ids: string[],
  vectors: number[][],
  topK = 10,
): { stats: { avgCosineSim: number; minCosineSim: number; maxCosineSim: number; avgNorm: number }; similarPairs: SimilarPair[] } {
  let sumSim = 0;
  let minSim = 1;
  let maxSim = -1;
  let pairCount = 0;
  let sumNorm = 0;
  const topPairs: SimilarPair[] = [];

  for (let i = 0; i < vectors.length; i++) {
    sumNorm += norm(vectors[i]);
  }

  // Sample up to 5000 pairs for large collections
  const maxPairs = 5000;
  const allPairs = (vectors.length * (vectors.length - 1)) / 2;
  const sampleRate = allPairs > maxPairs ? maxPairs / allPairs : 1;

  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      if (sampleRate < 1 && Math.random() > sampleRate) continue;
      const sim = cosineSimilarity(vectors[i], vectors[j]);
      sumSim += sim;
      if (sim < minSim) minSim = sim;
      if (sim > maxSim) maxSim = sim;
      pairCount++;

      if (topPairs.length < topK || sim > topPairs[topPairs.length - 1].similarity) {
        topPairs.push({ a: ids[i], b: ids[j], similarity: Math.round(sim * 1000) / 1000 });
        topPairs.sort((a, b) => b.similarity - a.similarity);
        if (topPairs.length > topK) topPairs.pop();
      }
    }
  }

  return {
    stats: {
      avgCosineSim: pairCount > 0 ? Math.round((sumSim / pairCount) * 1000) / 1000 : 0,
      minCosineSim: pairCount > 0 ? Math.round(minSim * 1000) / 1000 : 0,
      maxCosineSim: pairCount > 0 ? Math.round(maxSim * 1000) / 1000 : 0,
      avgNorm: vectors.length > 0 ? Math.round((sumNorm / vectors.length) * 1000) / 1000 : 0,
    },
    similarPairs: topPairs,
  };
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createEmbeddingsRoutes(embeddingPathOverride?: string, embeddingStore?: IEmbeddingStore): Router {
  const router = Router();

  router.get('/embeddings/projection', (_req: Request, res: Response) => { // lgtm[js/missing-rate-limiting] — parent router applies rate-limit
    try {
      let data: EmbeddingsFile;

      if (embeddingStore) {
        // Use IEmbeddingStore abstraction (works with both JSON and SQLite)
        const loaded = embeddingStore.load();
        if (!loaded) {
          return res.status(404).json({ success: false, error: 'No embeddings data in store' });
        }
        data = { indexHash: loaded.indexHash, modelName: loaded.modelName ?? 'unknown', embeddings: loaded.embeddings };
      } else {
        // Fallback: read directly from JSON file
        const embeddingPath = embeddingPathOverride ?? getRuntimeConfig().semantic.embeddingPath ?? '';
        if (!embeddingPath || !fs.existsSync(embeddingPath)) {
          return res.status(404).json({ success: false, error: 'Embeddings file not found' });
        }
        const raw = fs.readFileSync(embeddingPath, 'utf-8');
        data = JSON.parse(raw);
      }

      const ids = Object.keys(data.embeddings);
      const vectors = ids.map(id => data.embeddings[id]);

      if (ids.length === 0) {
        return res.json({
          success: true,
          count: 0,
          dimensions: 0,
          model: data.modelName,
          points: [],
          stats: { avgCosineSim: 0, minCosineSim: 0, maxCosineSim: 0, avgNorm: 0 },
          similarPairs: [],
        });
      }

      const dims = vectors[0].length;
      const projected = pcaProject(vectors);

      const points: ProjectedPoint[] = ids.map((id, i) => ({
        id,
        x: Math.round(projected[i].x * 10000) / 10000,
        y: Math.round(projected[i].y * 10000) / 10000,
        category: deriveCategory(id),
        norm: Math.round(norm(vectors[i]) * 10000) / 10000,
      }));

      const { stats, similarPairs } = computeStats(ids, vectors);

      return res.json({
        success: true,
        count: ids.length,
        dimensions: dims,
        model: data.modelName,
        points,
        stats,
        similarPairs,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: 'Failed to compute projection',
        message: (err as Error).message,
      });
    }
  });

  // GET /embeddings/status — surface model + cache state for the Embeddings tab
  router.get('/embeddings/status', (_req: Request, res: Response) => {
    try {
      const config = getRuntimeConfig();
      const sem = config.semantic;

      if (!sem.enabled) {
        return res.json({
          success: true,
          enabled: false,
          ready: false,
          state: 'disabled',
          message:
            'Semantic embeddings are disabled. Set INDEX_SERVER_SEMANTIC_ENABLED=1 and restart to enable.',
        });
      }

      const readiness = checkModelReadiness(sem.model, sem.cacheDir, sem.localOnly);

      let embeddingsFileExists = false;
      let embeddingsCount = 0;
      let embeddingsModelName: string | undefined;
      try {
        if (embeddingStore) {
          const loaded = embeddingStore.load();
          if (loaded) {
            embeddingsFileExists = true;
            embeddingsCount = Object.keys(loaded.embeddings || {}).length;
            embeddingsModelName = loaded.modelName ?? undefined;
          }
        } else {
          const file = embeddingPathOverride ?? sem.embeddingPath;
          if (file && fs.existsSync(file)) {
            embeddingsFileExists = true;
            const raw = fs.readFileSync(file, 'utf8');
            const parsed = JSON.parse(raw) as Partial<EmbeddingsFile>;
            embeddingsCount = parsed.embeddings ? Object.keys(parsed.embeddings).length : 0;
            embeddingsModelName = parsed.modelName ?? undefined;
          }
        }
      } catch { /* tolerate parse / read failures — surface as not present */ }

      // State machine for the dashboard banner.
      let state: 'ready' | 'will-download' | 'missing' | 'no-embeddings';
      if (!readiness.ready) {
        state = 'missing'; // localOnly=true and model not cached
      } else if (!readiness.cached) {
        state = 'will-download';
      } else if (!embeddingsFileExists || embeddingsCount === 0) {
        state = 'no-embeddings';
      } else {
        state = 'ready';
      }

      return res.json({
        success: true,
        enabled: true,
        ready: readiness.ready && embeddingsFileExists && embeddingsCount > 0,
        state,
        model: sem.model,
        device: sem.device,
        cacheDir: sem.cacheDir,
        localOnly: sem.localOnly,
        modelCached: readiness.cached,
        modelPath: readiness.modelPath,
        embeddingPath: sem.embeddingPath,
        embeddingsFileExists,
        embeddingsCount,
        embeddingsModelName,
        message: readiness.message,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: 'Failed to compute embeddings status',
        message: (err as Error).message,
      });
    }
  });

  // POST /embeddings/compute — trigger embedding computation for all instructions
  router.post('/embeddings/compute', dashboardAdminAuth, async (_req: Request, res: Response) => {
    try {
      const config = getRuntimeConfig();
      const sem = config.semantic;

      if (!sem.enabled) {
        return res.status(400).json({
          success: false,
          error: 'Semantic embeddings are disabled',
          hint: 'Set INDEX_SERVER_SEMANTIC_ENABLED=1 and restart the server',
        });
      }

      const state = (res.locals as IndexLocals).indexState;
      if (!state || !state.list || state.list.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No instructions loaded in index',
        });
      }

      const start = performance.now();
      const embeddings = await getInstructionEmbeddings(
        state.list, state.hash, sem.embeddingPath, sem.model, sem.cacheDir, sem.device, sem.localOnly
      );
      const elapsed = (performance.now() - start).toFixed(0);
      const count = Object.keys(embeddings).length;

      return res.json({
        success: true,
        count,
        model: sem.model,
        device: sem.device,
        elapsedMs: Number(elapsed),
        embeddingPath: sem.embeddingPath,
      });
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      // Detect the canonical "model not cached locally" signature from
      // @huggingface/transformers and translate to an actionable hint so
      // the dashboard can surface a useful banner.
      const isLocalOnlyMiss =
        /local_files_only=true/i.test(msg) ||
        /allowRemoteModels=false/i.test(msg) ||
        /file was not found locally/i.test(msg);
      return res.status(500).json({
        success: false,
        error: 'Failed to compute embeddings',
        message: msg,
        hint: isLocalOnlyMiss
          ? 'The embedding model is not cached locally and remote downloads are disabled. ' +
            'Set INDEX_SERVER_SEMANTIC_LOCAL_ONLY=0 and restart, or pre-stage the model in INDEX_SERVER_SEMANTIC_CACHE_DIR.'
          : undefined,
      });
    }
  });

  return router;
}
