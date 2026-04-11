import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Tracing Rotation Test
 * Validates that INDEX_SERVER_TRACE_MAX_FILE_SIZE triggers creation of rotated files (.1 suffix etc.)
 * and that summarizeTraceEnv reflects a non-zero rotationIndex after threshold exceeded.
 */

describe('Tracing Rotation', () => {
  it('rotates when max size exceeded', async () => {
    const traceDir = path.join(process.cwd(),'logs','trace');
    if(!fs.existsSync(traceDir)) fs.mkdirSync(traceDir,{recursive:true});
    const baseFile = path.join(traceDir, `rotation-test-${Date.now()}.jsonl`);
    // Configure very small max size to force rotation quickly
    process.env.INDEX_SERVER_TRACE_FILE = baseFile;
    process.env.INDEX_SERVER_TRACE_MAX_FILE_SIZE = '400'; // bytes
    process.env.INDEX_SERVER_TRACE_PERSIST = '1';
    process.env.INDEX_SERVER_TRACE_LEVEL = 'verbose';
    process.env.INDEX_SERVER_TRACE_CATEGORIES = 'rotation';
    process.env.INDEX_SERVER_TRACE_SESSION = 'rotation-session';

    const { emitTrace, summarizeTraceEnv } = await import('../services/tracing.js');

    // Emit multiple traces with moderately large payload to cross size threshold
    for(let i=0;i<30;i++){
      emitTrace('[trace:rotation:test]', { i, payload: 'x'.repeat(40) });
    }

    // Allow IO flush & potential rotations
    await new Promise(r=> setTimeout(r,120));

    const summary = summarizeTraceEnv();
    // Rotation index should be >= 1 OR we should have at least two files on disk
    const files = fs.readdirSync(traceDir).filter(f=> f.startsWith(path.basename(baseFile).replace(/\.jsonl$/,'')));
    const rotatedFiles = files.filter(f=> /\.\d+\.jsonl$/.test(f));

    expect(summary.file).toBeTruthy();
    expect(summary.session).toBe('rotation-session');
    expect(summary.level).toBeGreaterThan(0);
    expect(summary.maxFileSize).toBe(400);
    expect(summary.rotationIndex >= 1 || rotatedFiles.length >= 1).toBe(true);
  });
});
