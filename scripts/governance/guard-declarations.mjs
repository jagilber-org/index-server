#!/usr/bin/env node
/**
 * Guard script: enforces declaration file policy.
 * Fails (exit 1) if unexpected *.d.ts files appear in src/types/.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const typesDir = join(process.cwd(), 'src', 'types');
let ok = true;
// Allow list: keep only shims required for current compiler/runtime gaps.
const allowList = new Set(['sdk-shim.d.ts', 'node-sqlite.d.ts']);

try {
  const entries = readdirSync(typesDir).filter(f=>f.endsWith('.d.ts'));
  // Only treat non-allow-listed declaration files as offenders if they contain any *meaningful* content.
  // Files that are completely empty OR only have whitespace/comments are considered inert placeholders and ignored.
  const offenders = entries
    .filter(f=>!allowList.has(f))
    .filter(f=>{
      try {
        const raw = readFileSync(join(typesDir,f), 'utf8');
        const debugInfo = { file: f, rawLen: raw.length };
        // Remove BOM if present
        let processed = raw.replace(/^\uFEFF/, '');
        // Strip block comments /* ... */
        processed = processed.replace(/\/\*[\s\S]*?\*\//g, '');
        // Strip line comments // ...
        processed = processed.replace(/^\s*\/\/.*$/gm, '');
        // Remove common control chars just in case (CR/LF will be trimmed anyway)
        // eslint-disable-next-line no-control-regex
        processed = processed.replace(/[\u0000-\u001F\u007F]/g, '');
        const trimmed = processed.trim();
        // Heuristic: only flag if we detect TS declaration keywords (avoids placeholder text false positives)
        const keywordPattern = /\b(declare|export|interface|type|class|function|enum)\b/;
        const hasKeywords = keywordPattern.test(trimmed);
        debugInfo.afterLen = trimmed.length;
        debugInfo.hasKeywords = hasKeywords;
        if (!hasKeywords) {
          // Provide one-time verbose line per placeholder to aid future cleanup if needed
          if (trimmed.length > 0) {
            console.log('[guard-declarations][placeholder-ignored]', JSON.stringify(debugInfo));
          }
          return false; // ignore placeholder lacking real declarations
        }
        return true; // offender: contains declaration keywords
      } catch (e) {
        console.warn('[guard-declarations][read-error]', f, e?.message);
        return true; // could not read -> treat as offender to be safe
      }
    });
  if(offenders.length){
    console.error('[guard-declarations] Unexpected declaration files found:', offenders.join(', '));
    ok = false;
  } else {
    console.log('[guard-declarations] OK: only consolidated declarations present');
  }
} catch (e){
  console.error('[guard-declarations] Error reading types directory', e);
  ok = false;
}

process.exit(ok ? 0 : 1);
