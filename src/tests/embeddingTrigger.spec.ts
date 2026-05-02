/**
 * Tests for issue #282 fix #1 — auto-compute embeddings after import / restore.
 *
 * Verifies the gate logic in `embeddingTrigger.autoEmbedEnabled()`:
 *  - off when semantic disabled
 *  - on when semantic enabled and INDEX_SERVER_AUTO_EMBED_ON_IMPORT is unset
 *  - off when semantic enabled but INDEX_SERVER_AUTO_EMBED_ON_IMPORT=0
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { autoEmbedEnabled } from '../services/embeddingTrigger';
import { reloadRuntimeConfig } from '../config/runtimeConfig';

describe('embeddingTrigger.autoEmbedEnabled', () => {
  const saved = {
    sem: process.env.INDEX_SERVER_SEMANTIC_ENABLED,
    auto: process.env.INDEX_SERVER_AUTO_EMBED_ON_IMPORT,
  };

  beforeEach(() => {
    delete process.env.INDEX_SERVER_SEMANTIC_ENABLED;
    delete process.env.INDEX_SERVER_AUTO_EMBED_ON_IMPORT;
    reloadRuntimeConfig();
  });

  afterEach(() => {
    if (saved.sem !== undefined) process.env.INDEX_SERVER_SEMANTIC_ENABLED = saved.sem;
    else delete process.env.INDEX_SERVER_SEMANTIC_ENABLED;
    if (saved.auto !== undefined) process.env.INDEX_SERVER_AUTO_EMBED_ON_IMPORT = saved.auto;
    else delete process.env.INDEX_SERVER_AUTO_EMBED_ON_IMPORT;
    reloadRuntimeConfig();
  });

  it('returns false when semantic is disabled', () => {
    process.env.INDEX_SERVER_SEMANTIC_ENABLED = '0';
    reloadRuntimeConfig();
    expect(autoEmbedEnabled()).toBe(false);
  });

  it('returns true when semantic enabled and AUTO_EMBED unset (default ON)', () => {
    process.env.INDEX_SERVER_SEMANTIC_ENABLED = '1';
    reloadRuntimeConfig();
    expect(autoEmbedEnabled()).toBe(true);
  });

  it('returns false when semantic enabled but AUTO_EMBED explicitly off', () => {
    process.env.INDEX_SERVER_SEMANTIC_ENABLED = '1';
    process.env.INDEX_SERVER_AUTO_EMBED_ON_IMPORT = '0';
    reloadRuntimeConfig();
    expect(autoEmbedEnabled()).toBe(false);
  });

  it('returns true when both flags explicitly enabled', () => {
    process.env.INDEX_SERVER_SEMANTIC_ENABLED = '1';
    process.env.INDEX_SERVER_AUTO_EMBED_ON_IMPORT = '1';
    reloadRuntimeConfig();
    expect(autoEmbedEnabled()).toBe(true);
  });
});
