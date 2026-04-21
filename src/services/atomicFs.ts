import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getRuntimeConfig } from '../config/runtimeConfig';

/**
 * Atomically write JSON to disk with robust retry semantics for shared index scenarios.
 *
 * Rationale:
 *  - Multiple Index Server processes may share the same instructions directory.
 *  - On Windows / network filesystems, transient EPERM / EBUSY / EACCES can occur during rename
 *    when virus scanners, indexers or another process have the destination briefly open.
 *  - We mitigate by:
 *      1. Writing content to a unique temp file.
 *      2. Attempting fs.renameSync (atomic on same volume) with retry/backoff.
 *      3. Falling back to a direct fs.writeFileSync(dest, data) on final attempt if rename keeps failing
 *         specifically due to transient lock codes.
 *  - No file descriptors are intentionally left open; synchronous methods close before returning.
 *
 * Configuration (via runtime config / env consolidation):
 *  - atomicFs.retries (INDEX_SERVER_ATOMIC_WRITE_RETRIES, default 5) : total attempts (initial + retries)
 *  - atomicFs.backoffMs (INDEX_SERVER_ATOMIC_WRITE_BACKOFF_MS, default 10): initial backoff in ms (exponential with jitter)
 * @param filePath - Absolute path to the destination file
 * @param obj - Value to serialize as pretty-printed JSON
 * @throws Will throw if all write/rename attempts are exhausted due to non-transient errors
 */
export function atomicWriteJson(filePath: string, obj: unknown){
  const dir = path.dirname(filePath);
  if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  const data = JSON.stringify(obj,null,2);
  const atomicConfig = getRuntimeConfig().atomicFs;
  const maxAttempts = Math.max(1, atomicConfig.retries);
  const baseBackoff = Math.max(1, atomicConfig.backoffMs);
  let lastErr: unknown = null;
  for(let attempt=1; attempt<=maxAttempts; attempt++){
    const tmp = path.join(dir, `.${path.basename(filePath)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    try {
      fs.writeFileSync(tmp, data, 'utf8');
      try {
        fs.renameSync(tmp, filePath);
        return; // success
      } catch(renameErr){
        // If rename failed, decide whether to retry
        const code = (renameErr as NodeJS.ErrnoException).code;
        const transient = code==='EPERM' || code==='EBUSY' || code==='EACCES' || code==='ENOENT';
        if(!transient || attempt===maxAttempts){
          // On final attempt we do NOT fallback to direct write to preserve atomic semantics; propagate.
          lastErr = renameErr;
          try { if(fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
          break;
        }
        lastErr = renameErr;
        try { if(fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
        // Backoff (exponential + jitter)
        const sleepMs = baseBackoff * Math.pow(2, attempt-1) + Math.floor(Math.random()*baseBackoff);
        const start = Date.now();
        while(Date.now()-start < sleepMs){ /* busy-wait tiny backoff (short durations) */ }
        continue; // retry loop
      }
    } catch(writeErr){
      const code = (writeErr as NodeJS.ErrnoException).code;
      const transient = code==='EPERM' || code==='EBUSY' || code==='EACCES';
      if(!transient || attempt===maxAttempts){
        lastErr = writeErr;
        try { if(fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
        break;
      }
      lastErr = writeErr;
      try { if(fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
      const sleepMs = baseBackoff * Math.pow(2, attempt-1) + Math.floor(Math.random()*baseBackoff);
      const start = Date.now();
      while(Date.now()-start < sleepMs){ /* busy-wait */ }
      continue;
    }
  }
  // Propagate final error after exhausting attempts
  const err = lastErr instanceof Error? lastErr: new Error('atomicWriteJson failed');
  throw err;
}
