/**
 * T1 — Schema/conformance for FlagMeta extensions (issue #359 / plan §2.1, §2.6).
 *
 * RED-FIRST scaffold. These tests assert the FlagMeta shape extensions that
 * `extend-flagmeta` will introduce. They are expected to FAIL until that todo lands.
 *
 * Schema (per plan §2.1 + Morpheus revisions 2026-05-12):
 *   reloadBehavior: 'dynamic' | 'next-request' | 'restart-required'
 *   editable: discriminated union
 *     | { editable: true }
 *     | { editable: false; readonlyReason: 'derived'|'deprecated'|'reserved'|'sensitive'|'legacy'; readonlyDetail?: string }
 *   surfaces?: ('pinned' | 'advanced')[]
 *   validation?: {
 *     min?: number; max?: number; pattern?: string; enum?: string[];
 *     format?: 'url' | 'port' | 'path' | 'duration-ms' | 'host';
 *     unit?: string;
 *   }
 *
 * Default when classification is unclear: 'restart-required' (decision §3 #4).
 *
 * NOTE: Fields accessed via index notation so this file compiles before the
 * type extension lands. After `extend-flagmeta`, tighten via `as FlagMeta`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FLAG_REGISTRY } from '../services/handlers.dashboardConfig';

const VALID_RELOAD_BEHAVIORS = ['dynamic', 'next-request', 'restart-required'] as const;
type ReloadBehavior = typeof VALID_RELOAD_BEHAVIORS[number];

const VALID_READONLY_REASONS = ['derived', 'deprecated', 'reserved', 'sensitive', 'legacy'] as const;
const VALID_SURFACES = ['pinned', 'advanced'] as const;
const VALID_FORMATS = ['url', 'port', 'path', 'duration-ms', 'host'] as const;

function getField<T>(entry: unknown, key: string): T | undefined {
  return (entry as Record<string, unknown>)[key] as T | undefined;
}

describe('FlagMeta schema extensions (T1 — red-first; awaiting extend-flagmeta)', () => {
  describe('reloadBehavior', () => {
    it('every FLAG_REGISTRY entry declares reloadBehavior', () => {
      const missing = FLAG_REGISTRY
        .filter(f => getField<string>(f, 'reloadBehavior') === undefined)
        .map(f => f.name);
      expect(
        missing,
        `Add reloadBehavior to these entries (default to 'restart-required' when unclear):\n  - ${missing.join('\n  - ')}`,
      ).toEqual([]);
    });

    it('reloadBehavior values are restricted to the allowed set', () => {
      const invalid = FLAG_REGISTRY
        .map(f => ({ name: f.name, value: getField<string>(f, 'reloadBehavior') }))
        .filter(x => x.value !== undefined && !VALID_RELOAD_BEHAVIORS.includes(x.value as ReloadBehavior));
      expect(invalid, `invalid reloadBehavior values: ${JSON.stringify(invalid)}`).toEqual([]);
    });
  });

  describe('editable (discriminated union)', () => {
    it('every FLAG_REGISTRY entry declares editable: boolean', () => {
      const missing = FLAG_REGISTRY
        .filter(f => typeof getField<boolean>(f, 'editable') !== 'boolean')
        .map(f => f.name);
      expect(missing, `Add editable:boolean to: ${missing.join(', ')}`).toEqual([]);
    });

    it('editable:false entries declare a categorical readonlyReason', () => {
      const violations: string[] = [];
      for (const f of FLAG_REGISTRY) {
        if (getField<boolean>(f, 'editable') !== false) continue;
        const reason = getField<string>(f, 'readonlyReason');
        if (!reason) { violations.push(`${f.name} (missing)`); continue; }
        if (!VALID_READONLY_REASONS.includes(reason as typeof VALID_READONLY_REASONS[number])) {
          violations.push(`${f.name} (invalid: ${reason})`);
        }
      }
      expect(
        violations,
        `editable:false entries must declare readonlyReason ∈ {${VALID_READONLY_REASONS.join(', ')}}:\n  - ${violations.join('\n  - ')}`,
      ).toEqual([]);
    });

    it('editable:true entries do NOT carry a readonlyReason', () => {
      const violations = FLAG_REGISTRY
        .filter(f => getField<boolean>(f, 'editable') === true && getField<string>(f, 'readonlyReason') !== undefined)
        .map(f => f.name);
      expect(violations, `editable:true with stray readonlyReason: ${violations.join(', ')}`).toEqual([]);
    });

    it('reserved-stability entries are not editable AND have readonlyReason:"reserved"', () => {
      const violations: string[] = [];
      for (const f of FLAG_REGISTRY) {
        if (f.stability !== 'reserved') continue;
        if (getField<boolean>(f, 'editable') !== false) {
          violations.push(`${f.name} (editable should be false)`);
          continue;
        }
        if (getField<string>(f, 'readonlyReason') !== 'reserved') {
          violations.push(`${f.name} (readonlyReason should be 'reserved')`);
        }
      }
      expect(violations).toEqual([]);
    });
  });

  describe('surfaces', () => {
    it('surfaces (when present) is an array of allowed tokens', () => {
      const violations: string[] = [];
      for (const f of FLAG_REGISTRY) {
        const s = getField<unknown>(f, 'surfaces');
        if (s === undefined) continue;
        if (!Array.isArray(s)) { violations.push(`${f.name}: not array`); continue; }
        const bad = (s as string[]).filter(v => !VALID_SURFACES.includes(v as typeof VALID_SURFACES[number]));
        if (bad.length) violations.push(`${f.name}: ${bad.join(',')}`);
      }
      expect(violations).toEqual([]);
    });

    it('surfaces array has no duplicates', () => {
      const violations: string[] = [];
      for (const f of FLAG_REGISTRY) {
        const s = getField<string[]>(f, 'surfaces');
        if (!Array.isArray(s)) continue;
        if (new Set(s).size !== s.length) violations.push(f.name);
      }
      expect(violations).toEqual([]);
    });

    it('"pinned" surface ⇒ editable:true', () => {
      const violations = FLAG_REGISTRY
        .filter(f => (getField<string[]>(f, 'surfaces') ?? []).includes('pinned'))
        .filter(f => getField<boolean>(f, 'editable') !== true)
        .map(f => f.name);
      expect(violations, `pinned flags must be editable: ${violations.join(', ')}`).toEqual([]);
    });

    it('"pinned" surface ⇒ type is boolean or has an enum', () => {
      const violations: string[] = [];
      for (const f of FLAG_REGISTRY) {
        const surfaces = getField<string[]>(f, 'surfaces') ?? [];
        if (!surfaces.includes('pinned')) continue;
        const v = getField<{ enum?: string[] }>(f, 'validation');
        const ok = f.type === 'boolean' || (Array.isArray(v?.enum) && (v?.enum?.length ?? 0) > 0);
        if (!ok) violations.push(f.name);
      }
      expect(violations, `pinned flags must be boolean or have enum: ${violations.join(', ')}`).toEqual([]);
    });
  });

  describe('validation (when present)', () => {
    it('numeric flags with min/max have min <= max', () => {
      const violations: string[] = [];
      for (const f of FLAG_REGISTRY) {
        const v = getField<{ min?: number; max?: number }>(f, 'validation');
        if (v && typeof v.min === 'number' && typeof v.max === 'number' && v.min > v.max) {
          violations.push(`${f.name}: min=${v.min} > max=${v.max}`);
        }
      }
      expect(violations).toEqual([]);
    });

    it('enum validation is non-empty when present', () => {
      const violations: string[] = [];
      for (const f of FLAG_REGISTRY) {
        const v = getField<{ enum?: string[] }>(f, 'validation');
        if (v && v.enum !== undefined && (!Array.isArray(v.enum) || v.enum.length === 0)) {
          violations.push(f.name);
        }
      }
      expect(violations, `empty enum on: ${violations.join(', ')}`).toEqual([]);
    });

    it('string patterns compile as valid RegExp', () => {
      const violations: string[] = [];
      for (const f of FLAG_REGISTRY) {
        const v = getField<{ pattern?: string }>(f, 'validation');
        if (v && typeof v.pattern === 'string') {
          try { new RegExp(v.pattern); }
          catch { violations.push(`${f.name}: ${v.pattern}`); }
        }
      }
      expect(violations).toEqual([]);
    });

    it('format (when present) is restricted to the allowed set', () => {
      const violations: string[] = [];
      for (const f of FLAG_REGISTRY) {
        const v = getField<{ format?: string }>(f, 'validation');
        if (v?.format && !VALID_FORMATS.includes(v.format as typeof VALID_FORMATS[number])) {
          violations.push(`${f.name}: ${v.format}`);
        }
      }
      expect(violations, `invalid validation.format: ${violations.join('; ')}`).toEqual([]);
    });

    it('format:"port" only on numeric flags; format:"url"/"host"/"path" only on string', () => {
      const violations: string[] = [];
      for (const f of FLAG_REGISTRY) {
        const v = getField<{ format?: string }>(f, 'validation');
        if (!v?.format) continue;
        if (v.format === 'port' && f.type !== 'number') violations.push(`${f.name}: port on ${f.type}`);
        if ((v.format === 'url' || v.format === 'host' || v.format === 'path') && f.type !== 'string') {
          violations.push(`${f.name}: ${v.format} on ${f.type}`);
        }
        // 'duration-ms' allowed on number; no constraint required here.
      }
      expect(violations).toEqual([]);
    });

    it('unit (when present) is a non-empty string', () => {
      const violations: string[] = [];
      for (const f of FLAG_REGISTRY) {
        const v = getField<{ unit?: unknown }>(f, 'validation');
        if (v?.unit === undefined) continue;
        if (typeof v.unit !== 'string' || v.unit.length === 0) violations.push(f.name);
      }
      expect(violations).toEqual([]);
    });

    it('min/max only appear on numeric flags', () => {
      const violations: string[] = [];
      for (const f of FLAG_REGISTRY) {
        const v = getField<{ min?: number; max?: number }>(f, 'validation');
        if (!v) continue;
        if ((v.min !== undefined || v.max !== undefined) && f.type !== 'number') {
          violations.push(f.name);
        }
      }
      expect(violations).toEqual([]);
    });

    it('enum/pattern only appear on string flags', () => {
      const violations: string[] = [];
      for (const f of FLAG_REGISTRY) {
        const v = getField<{ enum?: string[]; pattern?: string }>(f, 'validation');
        if (!v) continue;
        if ((v.enum !== undefined || v.pattern !== undefined) && f.type !== 'string') {
          violations.push(f.name);
        }
      }
      expect(violations).toEqual([]);
    });
  });

  describe('boot-time-read audit (defaults to restart-required)', () => {
    // Regex-based audit. Any INDEX_SERVER_* read inside a constructor or
    // top-level load*/init*/setup*/build* block whose entry is marked
    // reloadBehavior !== 'restart-required' must be explicitly opted in via
    // `dynamicReadSite: true` on the FlagMeta entry.

    function readsAtBootTime(name: string): boolean {
      const srcRoot = path.join(process.cwd(), 'src');
      const files = walkTs(srcRoot);
      const reHit = new RegExp(`process\\.env\\[?['"\`]?${name}\\b`);
      for (const f of files) {
        if (/[\\/]tests[\\/]/.test(f)) continue;
        const txt = fs.readFileSync(f, 'utf8');
        if (!reHit.test(txt)) continue;
        const ctorBlocks = extractBlocks(txt, /constructor\s*\(/g);
        const initBlocks = extractBlocks(txt, /function\s+(load|init|setup|build)[A-Za-z]*\s*\(/g);
        for (const block of [...ctorBlocks, ...initBlocks]) {
          if (reHit.test(block)) return true;
        }
      }
      return false;
    }

    it('boot-time reads default to restart-required (unless dynamicReadSite annotated)', () => {
      const violations: string[] = [];
      for (const f of FLAG_REGISTRY) {
        const rb = getField<ReloadBehavior>(f, 'reloadBehavior');
        if (rb === 'restart-required' || rb === undefined) continue;
        if (!readsAtBootTime(f.name)) continue;
        const annotated = getField<boolean>(f, 'dynamicReadSite') === true;
        if (!annotated) violations.push(`${f.name} (${rb})`);
      }
      expect(
        violations,
        `These flags are read at boot time and must be 'restart-required' OR add dynamicReadSite:true with evidence:\n  - ${violations.join('\n  - ')}`,
      ).toEqual([]);
    });
  });
});

// ----- helpers -----

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/node_modules|dist|test-artifacts|test-results/.test(full)) continue;
      walkTs(full, out);
    } else if (/\.ts$/.test(entry.name) && !/\.spec\.|\.test\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function extractBlocks(src: string, startRe: RegExp): string[] {
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  startRe.lastIndex = 0;
  while ((m = startRe.exec(src)) !== null) {
    const openIdx = src.indexOf('{', m.index);
    if (openIdx < 0) continue;
    let depth = 0;
    for (let i = openIdx; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { blocks.push(src.slice(openIdx, i + 1)); break; }
      }
    }
  }
  return blocks;
}
