import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

// Verifies every accepted on-disk instruction with a sourceHash field matches SHA256(body).
// This guards against accidental manual edits to body without hash refresh.

async function readJson(file:string) {
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

function sha256(input:string) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

const INSTRUCTION_DIRS = [
  path.join(process.cwd(), 'instructions'),
  path.join(process.cwd(), 'devinstructions')
];

describe('instruction bodyHash integrity', () => {
  for (const dir of INSTRUCTION_DIRS) {
    it(`all sourceHash values match body in ${path.basename(dir)}`, async () => {
      let files: string[] = [];
      try {
        files = (await fs.readdir(dir)).filter(f => f.endsWith('.json') && !f.startsWith('_'));
      } catch {
        return; // directory may not exist in some environments
      }

      const mismatches: Array<{ file:string; expected:string; actual:string }>=[];
      for (const f of files) {
        const full = path.join(dir, f);
        const data = await readJson(full);
        if (!data || typeof data !== 'object') continue;
        if (!data.body || typeof data.body !== 'string') continue; // schema test covers this
        if (!data.sourceHash) continue; // allow files still pending enrichment
        if (!/^([a-f0-9]{64})$/.test(data.sourceHash)) continue; // other tests check pattern
        const recomputed = sha256(data.body);
        if (recomputed !== data.sourceHash) {
          mismatches.push({ file: f, expected: recomputed, actual: data.sourceHash });
        }
      }
      if (mismatches.length) {
        const details = mismatches.map(m => `${m.file}: expected=${m.expected} actual=${m.actual}`).join('\n');
        expect.fail(`Instruction sourceHash mismatch(es):\n${details}`);
      }
      expect(true).toBe(true);
    });
  }
});
