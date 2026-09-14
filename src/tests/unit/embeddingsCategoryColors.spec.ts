/**
 * Issue #534 defect 2 — incomplete category colour map.
 *
 * `admin.embeddings.js` hand-maintains CAT_COLORS. `categoryRules.ts` can emit
 * 19 labels + 'Other'; CAT_COLORS shipped only 13 + 'Other'. The six orphans
 * (Kusto, .NET, Mermaid, Governance, Operations, Documentation) fell through
 * `catColor`'s default, which returns the SAME hex as 'Other' (#95a5a6) — so
 * six real categories rendered indistinguishable from the unclassified bucket.
 *
 * A hand-maintained map WILL drift again. These are the drift alarm: adding a
 * rule to CATEGORY_RULES without a colour fails the suite by construction.
 *
 * Constitution refs: TS-8, TS-9, TS-12.
 *
 * Approach: CAT_COLORS lives inside an IIFE in a browser asset and is not
 * exported, and the repo carries no jsdom. Following the established repo
 * convention (xssThroughDomRegression.spec.ts, dashboardClientSecurityHardening),
 * we assert STRUCTURAL invariants by parsing the source literal — no eval, no
 * DOM. Removing a colour re-introduces the defect and fails here.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CATEGORY_RULES } from '../../services/categoryRules.js';

const CLIENT_JS = path.resolve(
  __dirname, '..', '..', 'dashboard', 'client', 'js', 'admin.embeddings.js',
);
const SRC = fs.readFileSync(CLIENT_JS, 'utf8');

/** Extract the CAT_COLORS object literal body from the client source. */
function catColorsBlock(): string {
  const start = SRC.indexOf('const CAT_COLORS');
  expect(start, 'CAT_COLORS declaration not found in admin.embeddings.js').toBeGreaterThan(-1);
  const open = SRC.indexOf('{', start);
  const close = SRC.indexOf('};', open);
  expect(close, 'CAT_COLORS literal is not terminated with };').toBeGreaterThan(open);
  return SRC.slice(open + 1, close);
}

/** Parse the literal into label -> hex without executing the asset. */
function parseCatColors(): Record<string, string> {
  const out: Record<string, string> = {};
  const pairs = /'([^']+)'\s*:\s*'(#[0-9a-fA-F]{3,8})'/g;
  let m: RegExpExecArray | null;
  while ((m = pairs.exec(catColorsBlock())) !== null) out[m[1]] = m[2].toLowerCase();
  return out;
}

/** The `catColor(cat)` miss-fallback hex, read from source. */
function fallbackHex(): string {
  const m = /function catColor\([^)]*\)\s*\{[^}]*\|\|\s*'(#[0-9a-fA-F]{3,8})'/.exec(SRC);
  expect(m, 'catColor fallback colour not found in admin.embeddings.js').not.toBeNull();
  return (m as RegExpExecArray)[1].toLowerCase();
}

const RULE_LABELS = CATEGORY_RULES.map(([, label]) => label);

describe('#534 embeddings colour map completeness (admin.embeddings.js CAT_COLORS)', () => {

  it('parses a plausible CAT_COLORS literal from the client asset', () => {
    // Guards the guard: if the parser silently returned {}, every other
    // assertion below would pass vacuously.
    const colors = parseCatColors();
    expect(Object.keys(colors).length).toBeGreaterThanOrEqual(RULE_LABELS.length + 1);
    expect(colors['Azure']).toMatch(/^#[0-9a-f]{6}$/);
    expect(colors['Other']).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('gives every label CATEGORY_RULES can return an explicit colour', () => {
    const colors = parseCatColors();
    const missing = RULE_LABELS.filter(label => !(label in colors));
    expect(missing, `CAT_COLORS is missing: ${missing.join(', ')}`).toEqual([]);
  });

  it('covers the six labels the #534 report found orphaned', () => {
    const colors = parseCatColors();
    for (const label of ['Kusto', '.NET', 'Mermaid', 'Governance', 'Operations', 'Documentation']) {
      expect(colors[label], `${label} has no colour`).toBeDefined();
    }
  });

  it('keeps an explicit Other colour distinct from every real category', () => {
    const colors = parseCatColors();
    const other = colors['Other'];
    expect(other).toBeDefined();
    const clashes = RULE_LABELS.filter(label => colors[label] === other);
    expect(clashes, `these render identically to Other: ${clashes.join(', ')}`).toEqual([]);
  });

  it('never reuses the catColor miss-fallback hex for a real category', () => {
    // This is the precise mechanism of the defect: catColor returned '#95a5a6'
    // on a miss, which was byte-identical to CAT_COLORS['Other'].
    const colors = parseCatColors();
    const fb = fallbackHex();
    const clashes = RULE_LABELS.filter(label => colors[label] === fb);
    expect(clashes, `indistinguishable from an unmapped category: ${clashes.join(', ')}`).toEqual([]);
  });

  it('assigns a unique colour to every mapped label', () => {
    const colors = parseCatColors();
    const byHex = new Map<string, string[]>();
    for (const [label, hex] of Object.entries(colors)) {
      byHex.set(hex, [...(byHex.get(hex) ?? []), label]);
    }
    const dupes = [...byHex.entries()].filter(([, labels]) => labels.length > 1);
    expect(dupes.map(([hex, labels]) => `${hex}: ${labels.join('/')}`)).toEqual([]);
  });

  it('maps no label that CATEGORY_RULES cannot produce (no dead colours)', () => {
    const allowed = new Set([...RULE_LABELS, 'Other']);
    const stale = Object.keys(parseCatColors()).filter(label => !allowed.has(label));
    expect(stale, `dead CAT_COLORS entries: ${stale.join(', ')}`).toEqual([]);
  });

  it('resolves every category to a colour distinct from Other under catColor semantics', () => {
    // The lived symptom: catColor(cat) is `CAT_COLORS[cat] || fallback`, and the
    // fallback was byte-identical to CAT_COLORS['Other'] — so an unmapped
    // category did not merely lose its colour, it silently *became* Other on
    // screen. Model the real resolution, not just map membership.
    const colors = parseCatColors();
    const fb = fallbackHex();
    const resolve = (label: string): string => colors[label] ?? fb;
    const otherHex = resolve('Other');
    const clashes = RULE_LABELS.filter(label => resolve(label) === otherHex);
    expect(clashes, 'these paint as Other on the canvas: ' + clashes.join(', ')).toEqual([]);
  });
});
