import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// Node16/NodeNext moduleResolution requires explicit file extensions for relative ESM-style imports.
// Tests compile under that mode; add .js so emitted CJS/ESM interop resolves correctly.
import * as atomic from '../services/atomicFs.js';

describe('atomicWriteJson retry semantics', () => {
  it('retries transient rename failures and eventually succeeds without blocking timers', async () => {
    const dir = path.join(process.cwd(), 'tmp', 'atomic-retry-test');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, 'sample.json');
    let renameCalls = 0;
    let timerFired = false;
    const realRename = fs.renameSync;
    (fs as any).renameSync = (oldPath: string, newPath: string) => {
      renameCalls++;
      if (renameCalls <= 2) {
        const err: any = new Error('simulated EPERM');
        err.code = 'EPERM';
        throw err;
      }
      return realRename(oldPath, newPath);
    };
    try {
      process.env.INDEX_SERVER_ATOMIC_WRITE_RETRIES = '5';
      process.env.INDEX_SERVER_ATOMIC_WRITE_BACKOFF_MS = '10';
      const timer = new Promise<void>(resolve => {
        setTimeout(() => {
          timerFired = true;
          resolve();
        }, 0);
      });
      const write = atomic.atomicWriteJsonAsync(target, { ok: true, ts: Date.now() });
      await timer;
      await write;
      const raw = JSON.parse(fs.readFileSync(target, 'utf8'));
      expect(raw.ok).toBe(true);
      expect(timerFired).toBe(true);
      expect(renameCalls).toBeGreaterThanOrEqual(3);
    } finally {
      (fs as any).renameSync = realRename;
    }
  });

  it('throws after exhausting retries on persistent failure', async () => {
    const dir = path.join(process.cwd(), 'tmp', 'atomic-retry-hard-fail');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, 'hard.json');
    const realRename = fs.renameSync;
    const realWrite = fs.writeFileSync;
    let attempts = 0; let writeAttempts=0;
    (fs as any).writeFileSync = (...args: any[]) => {
      writeAttempts++;
  // @ts-expect-error intentional dynamic arg forward for test shim
      realWrite(...args);
    };
    (fs as any).renameSync = () => {
      attempts++;
      const err: any = new Error('simulated permanent failure');
      err.code = 'EACCES';
      throw err;
    };
    try {
      process.env.INDEX_SERVER_ATOMIC_WRITE_RETRIES = '3';
      process.env.INDEX_SERVER_ATOMIC_WRITE_BACKOFF_MS = '1';
      await expect(atomic.atomicWriteJsonAsync(target, { fail: true })).rejects.toThrow();
      expect(attempts).toBeGreaterThanOrEqual(3);
      expect(writeAttempts).toBeGreaterThanOrEqual(3); // one per attempt
    } finally {
      (fs as any).renameSync = realRename;
      (fs as any).writeFileSync = realWrite;
    }
  });
});
