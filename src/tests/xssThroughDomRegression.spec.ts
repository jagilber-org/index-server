/**
 * Regression tests for issue #352 / CodeQL alert #15 (js/xss-through-dom).
 *
 * Origin: 15-alert security wave on jagilber-org/index-server mirror.
 * Owner (red phase): Tank.  Owner (green phase, if needed): Mouse.
 *
 * Constitution refs:
 *   TS-8  — TDD red/green NON-NEGOTIABLE
 *   TS-9  — every bug fix MUST start with a failing regression test
 *   TS-12 — at least 5 cases per regression
 *
 * Target file: src/dashboard/client/js/admin.graph.js
 *   - sanitizeGraphSvg          (line ~123)
 *   - SVG_ALLOWED_TAGS allowlist (line ~33)
 *   - SVG_ALLOWED_ATTRS allowlist (line ~40)
 *   - hasUnsafeUrlValue          (line ~62)
 *   - sanitizeSvgStyleText       (line ~74)
 *   - renderGraphSvg             (line ~149)
 *
 * Approach (see Tank → Morpheus note, AG-3)
 * -----------------------------------------
 * `sanitizeGraphSvg` is defined inside an IIFE in admin.graph.js and is NOT
 * exported. The repo has no jsdom/happy-dom in devDependencies and Playwright
 * requires a running dashboard server, so live-execution against the function
 * is not possible without either (a) adding a DOM library, or (b) a small
 * production-code change to expose a test hook.
 *
 * Until Morpheus decides which path to take, this regression suite follows
 * the established repo convention used by `dashboardClientSecurityHardening.spec.ts`:
 * STRUCTURAL invariants on the source code. Each adversarial scenario is mapped
 * to a structural assertion such that REMOVING the mitigation re-introduces
 * the vulnerability and fails the suite.
 *
 * This is the same testing strategy the project chose for the original Mermaid
 * SVG XSS fix (see PR history referenced in dashboardClientSecurityHardening),
 * so adopting it here keeps the bar consistent.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = fs.readFileSync(
  path.resolve(__dirname, '..', 'dashboard', 'client', 'js', 'admin.graph.js'),
  'utf8'
);

describe('#352 XSS-through-DOM regression (admin.graph.js sanitizeGraphSvg)', () => {
  // ---------------------------------------------------------------------
  // Adversarial scenarios → structural invariants
  // ---------------------------------------------------------------------

  it('case 1 — <script> tags: "script" is NOT in SVG_ALLOWED_TAGS allowlist', () => {
    // The allowlist is the choke point that prevents script reconstruction.
    // If `script` ever appears as a key, the allowlist-rebuild pipeline would
    // re-emit it. Assert the tag map contains only known-safe tag names.
    const allowlistBlock = SRC.match(/const SVG_ALLOWED_TAGS = new Map\(\[([\s\S]*?)\]\);/);
    expect(allowlistBlock, 'SVG_ALLOWED_TAGS map must exist').toBeTruthy();
    const body = allowlistBlock![1].toLowerCase();
    for (const banned of ['script', 'foreignobject', 'iframe', 'object', 'embed', 'animate', 'set', 'handler']) {
      expect(body, `tag "${banned}" must NOT be allowlisted`).not.toMatch(
        new RegExp(`['"]${banned}['"]`)
      );
    }
  });

  it('case 2 — event-handler attrs (onload, onclick, etc.): all on* names are rejected', () => {
    // Regardless of allowlist content, attribute names starting with "on" are
    // dropped before allowlist lookup. This is the strongest defense — a new
    // event attribute added to a browser is automatically denied.
    expect(SRC).toMatch(/name\.startsWith\(['"]on['"]\)/);
    // And the allowlist itself must not include any on* attr names.
    const attrBlock = SRC.match(/const SVG_ALLOWED_ATTRS = new Set\(\[([\s\S]*?)\]\);/);
    expect(attrBlock, 'SVG_ALLOWED_ATTRS set must exist').toBeTruthy();
    const attrBody = attrBlock![1];
    expect(attrBody, 'no on* event handler attrs allowlisted').not.toMatch(/['"]on[a-z]+['"]/i);
  });

  it('case 3 — javascript:/vbscript:/data: URLs: rejected by hasUnsafeUrlValue', () => {
    // The unsafe-URL gate must cover all three known XSS URL schemes.
    expect(SRC).toMatch(/javascript\|vbscript\|data/);
    // And it must be applied to attribute values during sanitization.
    expect(SRC).toMatch(/hasUnsafeUrlValue\(value\)/);
    // And to style text content separately (CSS url(...) channel).
    expect(SRC).toMatch(/hasUnsafeUrlValue\(css\)/);
  });

  it('case 4 — href / xlink:href: only fragment refs (#id) allowed, blocking absolute javascript: hrefs', () => {
    // Per source line ~96: href/xlink:href values must match /^\s*#[-\w:.]+\s*$/i
    // — anything else (including javascript:foo) gets dropped before assignment.
    expect(SRC).toMatch(/name === ['"]href['"].*xlink:href[\s\S]{0,200}\^\s*\\s\*#/);
  });

  it('case 5 — <style> CSS-injection vectors (@import, expression, -moz-binding, behavior, </style): rejected', () => {
    // sanitizeSvgStyleText hard-rejects CSS containing any of these.
    expect(SRC).toMatch(/@import\|expression/);
    expect(SRC).toMatch(/-moz-binding\|behavior/);
    expect(SRC).toMatch(/<\\\/style/);
  });

  it('case 6 — DOM identity is severed: parse → allowlist-rebuild → serialize → reparse', () => {
    // The 3-step pipeline guarantees no original node identity flows from
    // untrusted markup into the live DOM. Static analyzers (and any future
    // reviewer) must be able to see this structural separation.
    expect(SRC).toMatch(/new DOMParser\(\)\.parseFromString\(String\(svgMarkup/);
    expect(SRC).toMatch(/sanitizeSvgNode\(parsed\.documentElement\)/);
    expect(SRC).toMatch(/new XMLSerializer\(\)\.serializeToString\(reconstructed\)/);
    // Crucial: the SECOND parse runs on the post-serialize string, not the
    // original input — this is the "data-flow cut" the analyzer relies on.
    expect(SRC).toMatch(/new DOMParser\(\)\.parseFromString\(safeMarkup/);
  });

  it('case 7 — rebuild uses createElementNS, NOT importNode/cloneNode of untrusted nodes', () => {
    // importNode of untrusted parsed nodes WOULD re-introduce the original
    // node identity into the live DOM — the exact pattern CodeQL flagged.
    expect(SRC).toContain('document.createElementNS');
    expect(SRC).not.toMatch(/document\.importNode\s*\(\s*parsed/);
    expect(SRC).not.toMatch(/parsed\.documentElement\.cloneNode/);
  });

  it('case 8 — DOM insertion uses replaceChildren(safeNode), never innerHTML = svgText', () => {
    // The renderGraphSvg sink. innerHTML = <untrusted> would bypass the whole
    // pipeline. Must use the live-node replaceChildren path with the
    // sanitized DOM subtree only.
    expect(SRC).toMatch(/host\.replaceChildren\(safeSvg\)/);
    expect(SRC).not.toMatch(/host\.innerHTML\s*=\s*svgMarkup/);
    expect(SRC).not.toMatch(/host\.innerHTML\s*=\s*safeMarkup/);
  });

  it('case 9 — parser errors and non-<svg> roots are rejected (returns null)', () => {
    // Adversarial input that smuggles a non-SVG root (e.g. <html>) or has a
    // parse error must NOT be rendered. Both the first and second parse must
    // gate on parsererror + root tag === 'svg'.
    const parserErrorGates = SRC.match(/parsererror|tagName\.toLowerCase\(\) !== ['"]svg['"]/g) || [];
    expect(parserErrorGates.length, 'expect ≥2 parser-error gates (first + reparse)').toBeGreaterThanOrEqual(2);
  });

  it('case 10 — IIFE encapsulation: sanitizer internals are not leaked to global scope', () => {
    // The file is wrapped `(function(){ ... })();` — sanitizer functions
    // remain module-private so adversaries can't monkey-patch them from a
    // sibling script. (This is also why we can't unit-test the function
    // directly without a test hook — see file header.)
    expect(SRC).toMatch(/^\s*\/\*\s*eslint-disable\s*\*\/[\s\S]*?\(function\(\)\s*\{/);
    expect(SRC.trimEnd()).toMatch(/\}\)\(\);\s*$/);
  });
});
