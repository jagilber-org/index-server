/**
 * GET /api/embeddings/status — empirical-ready override (#318).
 *
 * Reproduces the false-positive "model not available" banner the user reported
 * on the Embeddings dashboard tab:
 *
 *   - `INDEX_SERVER_SEMANTIC_LOCAL_ONLY=1`
 *   - cacheDir set, but the model is not under the `models--<owner>--<name>`
 *     layout that `checkModelReadiness` inspects
 *   - embeddings.json file exists and contains entries for the configured model
 *
 * Previously the route would report `state: 'missing'` and the UI would render
 * an actionable error banner ("Model not available — compute will fail") even
 * though embeddings demonstrably work. The fix prefers the empirical signal
 * (non-empty embeddings file with matching `modelName`) and reports
 * `state: 'ready'`.
 *
 * Refs: jagilber-dev/index-server#318
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEmbeddingsRoutes } from '../../dashboard/server/routes/embeddings.routes.js';

vi.mock('../../config/runtimeConfig.js', async () => {
  const actual = await vi.importActual<typeof import('../../config/runtimeConfig.js')>(
    '../../config/runtimeConfig.js'
  );
  return { ...actual, getRuntimeConfig: vi.fn() };
});

vi.mock('../../services/embeddingService.js', async () => {
  const actual = await vi.importActual<typeof import('../../services/embeddingService.js')>(
    '../../services/embeddingService.js'
  );
  return { ...actual, checkModelReadiness: vi.fn() };
});

import { getRuntimeConfig } from '../../config/runtimeConfig.js';
import { checkModelReadiness } from '../../services/embeddingService.js';

type RuntimeConfig = ReturnType<typeof getRuntimeConfig>;

function makeConfig(overrides: Partial<RuntimeConfig['semantic']> = {}): RuntimeConfig {
  return {
    semantic: {
      enabled: true,
      model: 'Xenova/all-MiniLM-L6-v2',
      device: 'cpu',
      cacheDir: 'C:/no/such/dir',
      localOnly: true,
      embeddingPath: '',
      ...overrides,
    },
  } as unknown as RuntimeConfig;
}

/** Locate the GET /embeddings/status handler from the express Router. */
function findStatusHandler(embeddingPath: string) {
  const router = createEmbeddingsRoutes(embeddingPath, undefined);
  type RouteHandler = (req: unknown, res: unknown) => unknown;
  const layers = (router as unknown as { stack: Array<{
    route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RouteHandler }> };
  }> }).stack;
  const layer = layers.find(
    (l) => l.route && l.route.path === '/embeddings/status' && l.route.methods.get
  );
  if (!layer || !layer.route) throw new Error('GET /embeddings/status handler not found');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function callStatus(embeddingPath: string): Promise<{ status: number; body: any }> {
  const handler = findStatusHandler(embeddingPath);
  let capturedStatus = 200;
  let capturedBody: unknown;
  const res = {
    status(code: number) {
      capturedStatus = code;
      return this;
    },
    json(body: unknown) {
      capturedBody = body;
      return this;
    },
  };
  await handler({}, res);
  return { status: capturedStatus, body: capturedBody as any };
}

describe('GET /embeddings/status — empirical-ready override (#318)', () => {
  let tmpDir: string;
  let embPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iss318-'));
    embPath = path.join(tmpDir, 'embeddings.json');
    vi.mocked(getRuntimeConfig).mockReturnValue(
      makeConfig({ embeddingPath: embPath })
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('reports ready when embeddings file exists with matching modelName, even if readiness reports missing', async () => {
    // checkModelReadiness reports "missing" — its narrow cache-layout check
    // couldn't find the model. This is the bug-triggering condition.
    vi.mocked(checkModelReadiness).mockReturnValue({
      ready: false,
      cached: false,
      modelPath: 'C:/no/such/dir/models--Xenova--all-MiniLM-L6-v2',
      message: 'not found',
    });

    fs.writeFileSync(
      embPath,
      JSON.stringify({
        indexHash: 'h1',
        modelName: 'Xenova/all-MiniLM-L6-v2',
        embeddings: { 'inst-a': [0.1, 0.2], 'inst-b': [0.3, 0.4] },
      })
    );

    const res = await callStatus(embPath);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('ready');
    expect(res.body.ready).toBe(true);
    expect(res.body.embeddingsCount).toBe(2);
    expect(res.body.modelCached).toBe(true);
    expect(res.body.message).toBeUndefined();
  });

  it('still reports missing when no embeddings file exists', async () => {
    vi.mocked(checkModelReadiness).mockReturnValue({
      ready: false,
      cached: false,
      modelPath: 'C:/no/such/dir/models--Xenova--all-MiniLM-L6-v2',
      message: 'not found',
    });

    const res = await callStatus(embPath);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('missing');
    expect(res.body.ready).toBe(false);
  });

  it('does not override when the embeddings file modelName mismatches the configured model', async () => {
    vi.mocked(checkModelReadiness).mockReturnValue({
      ready: false,
      cached: false,
      modelPath: 'C:/no/such/dir/models--Xenova--all-MiniLM-L6-v2',
      message: 'not found',
    });

    fs.writeFileSync(
      embPath,
      JSON.stringify({
        indexHash: 'h1',
        modelName: 'some-other-model',
        embeddings: { 'inst-a': [0.1] },
      })
    );

    const res = await callStatus(embPath);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('missing');
  });

  it('reports ready normally when readiness.ready is true (no behavior change)', async () => {
    vi.mocked(checkModelReadiness).mockReturnValue({
      ready: true,
      cached: true,
      modelPath: 'C:/cache/models--Xenova--all-MiniLM-L6-v2',
    });

    fs.writeFileSync(
      embPath,
      JSON.stringify({
        indexHash: 'h1',
        modelName: 'Xenova/all-MiniLM-L6-v2',
        embeddings: { 'inst-a': [0.1] },
      })
    );

    const res = await callStatus(embPath);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('ready');
    expect(res.body.ready).toBe(true);
  });
});
