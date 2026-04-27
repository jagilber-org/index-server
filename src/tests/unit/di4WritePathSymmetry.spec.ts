/**
 * DI-4 enforcement guard (constitution v2.9.0).
 *
 * Constitutional principle DI-4 requires every write path to mirror the
 * read path: any record passing through a writer MUST run the same
 * migration and validation sequence the loader runs at read time.
 *
 * Concretely, in this codebase that means: every site that calls
 * `validateForDisk(record)` prior to persisting a record MUST also call
 * `migrateInstructionRecord(record)` somewhere earlier in the same function.
 *
 * This test scans the source tree, locates every function containing a
 * `validateForDisk(` call, and asserts the same function body contains a
 * `migrateInstructionRecord(` call appearing before the first
 * `validateForDisk(` call in that function — unless the call site is
 * explicitly opted out (post-write read-back checks where the record was
 * just persisted and is being verified rather than prepared for write).
 */

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(__dirname, '../../');

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === 'tests' || ent.name === '__tests__') continue;
        stack.push(full);
      } else if (ent.isFile() && (ent.name.endsWith('.ts') || ent.name.endsWith('.tsx')) && !ent.name.endsWith('.d.ts') && !ent.name.endsWith('.spec.ts')) {
        out.push(full);
      }
    }
  }
  return out;
}

interface CallSite {
  file: string;
  line: number;
  context: string;
  optedOut: boolean;
}

interface Violation {
  file: string;
  line: number;
  context: string;
  reason: string;
}

/**
 * Locate the enclosing function/method body (by simple brace-depth scanning)
 * that surrounds a given line index, then verify the body contains
 * `migrateInstructionRecord(` somewhere before the validate call line.
 *
 * This is a deliberately simple heuristic — it does not parse TypeScript.
 * It walks backward from the call site collecting opening braces at the
 * function/method declaration, then forward to the matching close brace.
 */
function functionBodyContainingLine(lines: string[], targetIdx: number): { start: number; end: number } | null {
  let depth = 0;
  let bodyStart = -1;
  for (let i = targetIdx; i >= 0; i--) {
    const line = lines[i];
    for (let c = line.length - 1; c >= 0; c--) {
      const ch = line[c];
      if (ch === '}') depth++;
      else if (ch === '{') {
        if (depth === 0) {
          bodyStart = i;
          break;
        }
        depth--;
      }
    }
    if (bodyStart >= 0) break;
  }
  if (bodyStart < 0) return null;
  let endDepth = 1;
  let bodyEnd = -1;
  for (let i = bodyStart + 1; i < lines.length; i++) {
    const line = lines[i];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '{') endDepth++;
      else if (ch === '}') {
        endDepth--;
        if (endDepth === 0) {
          bodyEnd = i;
          break;
        }
      }
    }
    if (bodyEnd >= 0) break;
  }
  if (bodyEnd < 0) bodyEnd = lines.length - 1;
  return { start: bodyStart, end: bodyEnd };
}

describe('DI-4: write paths mirror read paths (constitution v2.9.0)', () => {
  it('every validateForDisk call site has a preceding migrateInstructionRecord call in the same function (or is explicitly opted out)', () => {
    const files = listSourceFiles(path.join(SRC_ROOT, 'services'))
      .concat(listSourceFiles(path.join(SRC_ROOT, 'server')));

    const callSites: CallSite[] = [];
    for (const file of files) {
      // Skip the validator implementation itself.
      if (file.endsWith('loaderSchemaValidator.ts')) continue;
      const src = fs.readFileSync(file, 'utf8');
      const lines = src.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match `validateForDisk(` but skip the import line.
        if (!/\bvalidateForDisk\s*\(/.test(line)) continue;
        if (/^\s*import\b/.test(line)) continue;
        // Opt-out marker: a comment within the prior 6 lines stating
        // this is a post-write read-back, not a pre-write gate.
        const windowStart = Math.max(0, i - 6);
        const windowText = lines.slice(windowStart, i + 1).join('\n');
        const optedOut = /DI-4-EXEMPT|post-write read-back/i.test(windowText);
        callSites.push({ file, line: i + 1, context: line.trim(), optedOut });
      }
    }

    // Sanity: we must find at least the known call sites.
    expect(callSites.length).toBeGreaterThanOrEqual(3);

    const violations: Violation[] = [];
    for (const cs of callSites) {
      if (cs.optedOut) continue;
      const src = fs.readFileSync(cs.file, 'utf8');
      const lines = src.split(/\r?\n/);
      const callIdx = cs.line - 1;
      const body = functionBodyContainingLine(lines, callIdx);
      if (!body) {
        violations.push({ file: cs.file, line: cs.line, context: cs.context, reason: 'could not locate enclosing function body' });
        continue;
      }
      let foundMigrate = false;
      for (let i = body.start; i < callIdx; i++) {
        const ln = lines[i];
        if (/^\s*\/\//.test(ln) || /^\s*\*/.test(ln)) continue;
        if (/\bmigrateInstructionRecord\s*\(/.test(ln) && !/^\s*import\b/.test(ln)) {
          foundMigrate = true;
          break;
        }
      }
      if (!foundMigrate) {
        violations.push({
          file: path.relative(SRC_ROOT, cs.file),
          line: cs.line,
          context: cs.context,
          reason: 'validateForDisk(...) is called but migrateInstructionRecord(...) is not invoked earlier in the same function. DI-4 requires write paths to mirror the loader (migrate -> validate). If this is a post-write read-back rather than a pre-write gate, add a comment marker like "Post-write read-back" or "DI-4-EXEMPT" on the same or previous line.',
        });
      }
    }

    if (violations.length) {
      const msg = violations.map(v => `${v.file}:${v.line}: ${v.reason}\n    ${v.context}`).join('\n\n');
      throw new Error(`DI-4 violation(s) found:\n\n${msg}`);
    }
  });
});
