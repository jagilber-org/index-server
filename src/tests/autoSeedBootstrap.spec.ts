import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { autoSeedBootstrap, _getCanonicalSeeds } from '../services/seedBootstrap';
import { reloadRuntimeConfig } from '../config/runtimeConfig';

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-auto-seed-'));
  return dir;
}

describe('autoSeedBootstrap', () => {
  const seeds = _getCanonicalSeeds();

  beforeEach(() => {
    delete process.env.INDEX_SERVER_AUTO_SEED;
    delete process.env.INDEX_SERVER_SEED_VERBOSE;
    reloadRuntimeConfig();
  });

  it('creates both seeds when directory empty', () => {
    const dir = makeTempDir();
    process.env.INDEX_SERVER_DIR = dir;
    const summary = autoSeedBootstrap();
    expect(summary.disabled).toBe(false);
    expect(summary.created.sort()).toEqual(seeds.map(s => s.file).sort());
    for(const s of seeds){
      const file = path.join(dir, s.file);
      expect(fs.existsSync(file)).toBe(true);
      const data = JSON.parse(fs.readFileSync(file,'utf8'));
      expect(data.id).toBe(s.id);
    }
  });

  // Regression: seed files written without createdAt/firstSeenTs trigger
  // [invariant-repair] firstSeenTs WARNs on every subsequent load. The write
  // path MUST stamp both fields so loaders observe a valid invariant.
  // (RCA 2026-05-01, dev port 8687, fix/ensure-loaded-cache-no-version-file)
  it('seed files include createdAt and firstSeenTs to avoid invariant-repair WARN spam', () => {
    const dir = makeTempDir();
    process.env.INDEX_SERVER_DIR = dir;
    autoSeedBootstrap();
    for(const s of seeds){
      const data = JSON.parse(fs.readFileSync(path.join(dir, s.file),'utf8'));
      expect(typeof data.createdAt).toBe('string');
      expect(typeof data.firstSeenTs).toBe('string');
      expect(Date.parse(data.createdAt)).toBeGreaterThan(0);
      expect(Date.parse(data.firstSeenTs)).toBeGreaterThan(0);
    }
  });

  it('is idempotent (second call creates nothing)', () => {
    const dir = makeTempDir();
    process.env.INDEX_SERVER_DIR = dir;
    const first = autoSeedBootstrap();
    expect(first.created.length).toBe(seeds.length);
    const second = autoSeedBootstrap();
    expect(second.created.length).toBe(0);
    expect(second.existing.sort()).toEqual(seeds.map(s => s.file).sort());
  });

  it('respects INDEX_SERVER_AUTO_SEED=0 (does not create)', () => {
    const dir = makeTempDir();
    process.env.INDEX_SERVER_DIR = dir;
    process.env.INDEX_SERVER_AUTO_SEED = '0';
    reloadRuntimeConfig();
    const summary = autoSeedBootstrap();
    expect(summary.disabled).toBe(true);
    expect(summary.created.length).toBe(0);
    for(const s of seeds){
      expect(fs.existsSync(path.join(dir, s.file))).toBe(false);
    }
  });
});
