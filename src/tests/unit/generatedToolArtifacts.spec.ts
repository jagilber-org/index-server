import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getToolRegistry } from '../../services/toolRegistry';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DOC_PATH = path.join(ROOT, 'docs', 'TOOLS-GENERATED.md');
const MAPPING_PATH = path.join(ROOT, 'scripts', 'mappings', 'server-env-tools.json');
const TOOLS_MD_PATH = path.join(ROOT, 'docs', 'tools.md');
const DIAGRAM_PATH = path.join(ROOT, 'docs', 'diagrams', 'tool-tier-architecture.mmd');
const DOC_GENERATOR = path.join(ROOT, 'scripts', 'build', 'generate-tools-doc.mjs');
const MAPPING_GENERATOR = path.join(ROOT, 'scripts', 'build', 'generate-server-env-tools.mjs');
const INVENTORY_GENERATOR = path.join(ROOT, 'scripts', 'build', 'generate-tool-inventory.mjs');
const originalDoc = fs.readFileSync(DOC_PATH, 'utf8');
const originalMapping = fs.readFileSync(MAPPING_PATH, 'utf8');
const originalToolsMd = fs.readFileSync(TOOLS_MD_PATH, 'utf8');
const originalDiagram = fs.readFileSync(DIAGRAM_PATH, 'utf8');

function generatorEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.INDEX_SERVER_FLAG_TOOLS_EXTENDED;
  delete env.INDEX_SERVER_FLAG_TOOLS_ADMIN;
  env.INDEX_SERVER_STRESS_DIAG = '1';
  env.INDEX_SERVER_MESSAGING_ENABLED = '1';
  return env;
}

let savedStressDiag: string | undefined;

beforeEach(() => {
  savedStressDiag = process.env.INDEX_SERVER_STRESS_DIAG;
  process.env.INDEX_SERVER_STRESS_DIAG = '1';
});

afterEach(() => {
  if (savedStressDiag === undefined) delete process.env.INDEX_SERVER_STRESS_DIAG;
  else process.env.INDEX_SERVER_STRESS_DIAG = savedStressDiag;
  fs.writeFileSync(DOC_PATH, originalDoc);
  fs.writeFileSync(MAPPING_PATH, originalMapping);
  fs.writeFileSync(TOOLS_MD_PATH, originalToolsMd);
  fs.writeFileSync(DIAGRAM_PATH, originalDiagram);
});

/** Tool names in the generated inventory table of docs/tools.md. */
function inventoryRows(markdown: string): string[] {
  const begin = markdown.indexOf('<!-- BEGIN GENERATED: tool inventory');
  const end = markdown.indexOf('<!-- END GENERATED: tool inventory');
  expect(begin, 'docs/tools.md lost its generated-region markers').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(begin);
  const block = markdown.slice(begin, end);
  return [...block.matchAll(/^\| `([^`]+)` \|/gm)].map(m => m[1]);
}

describe('generated tool artifacts', () => {
  it('keeps checked-in tool docs and mappings aligned with the registry', () => {
    const documented = (originalDoc.match(/^### (.+)$/gm) ?? []).map(line => line.slice(4));
    const mapped = (JSON.parse(originalMapping) as { toolNames: string[] }).toolNames;

    // #587: TOOLS-GENERATED.md was emitted at the `extended` tier, so all 31
    // admin tools were silently absent from the one file titled "Generated
    // Tool Registry". It now covers the full declared surface.
    expect(documented).toEqual(getToolRegistry({ tier: 'admin' }).map(entry => entry.name));
    expect(mapped).toEqual(getToolRegistry({ tier: 'admin' }).map(entry => entry.name));
  });

  it('generates the full admin documentation surface without ambient tier flags', () => {
    execFileSync(process.execPath, [DOC_GENERATOR], { cwd: ROOT, env: generatorEnv() });
    const generated = fs.readFileSync(DOC_PATH, 'utf8');
    const registry = getToolRegistry({ tier: 'admin' });
    const expected = registry.map(entry => `### ${entry.name}`);

    expect(expected).toHaveLength(65);
    for (const heading of expected) expect(generated).toContain(heading);
    expect(generated.match(/^### /gm) ?? []).toHaveLength(expected.length);
    // The tier note is the reason a reader can tell this is the whole surface.
    expect(generated).toContain('Tier: **admin**');
  });

  it('regenerates the complete toolNames mapping from the admin registry', () => {
    expect(fs.existsSync(MAPPING_GENERATOR)).toBe(true);
    execFileSync(process.execPath, [MAPPING_GENERATOR], { cwd: ROOT, env: generatorEnv() });
    const generated = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8')) as { toolNames: string[] };
    const expected = getToolRegistry({ tier: 'admin' }).map(entry => entry.name);

    expect(generated.toolNames).toEqual(expected);
  });

  it('keeps the docs/tools.md inventory table equal to the registry', () => {
    // The committed file, not a freshly generated one -- the point is to catch
    // a registry change that landed without regenerating the doc. The hand-
    // maintained table this replaces had drifted to 45 rows against 65 tools.
    const rows = inventoryRows(originalToolsMd);
    const expected = getToolRegistry({ tier: 'admin' }).map(entry => entry.name);

    expect(rows).toEqual(expected);
  });

  it('records each tool at its registered tier and classification', () => {
    const begin = originalToolsMd.indexOf('<!-- BEGIN GENERATED: tool inventory');
    const end = originalToolsMd.indexOf('<!-- END GENERATED: tool inventory');
    const block = originalToolsMd.slice(begin, end);
    const documented = new Map(
      [...block.matchAll(/^\| `([^`]+)` \| ([^|]+) \| ([^|]+) \|/gm)].map(m => [
        m[1],
        { classification: m[2].trim(), tier: m[3].trim() },
      ])
    );

    for (const entry of getToolRegistry({ tier: 'admin' })) {
      const row = documented.get(entry.name);
      expect(row, `${entry.name} missing from the inventory table`).toBeDefined();
      const expectedClassification =
        [entry.stable ? 'stable' : null, entry.mutation ? 'mutation' : null]
          .filter(Boolean)
          .join(', ') || '—';
      expect(row!.tier, `${entry.name} tier`).toBe(entry.tier);
      expect(row!.classification, `${entry.name} classification`).toBe(expectedClassification);
    }
  });

  it('keeps the tier diagram equal to the registry', () => {
    // `feedback_dispatch`, `feedback_list`, `feedback_get`, `feedback_update`,
    // `feedback_stats` and `feedback_health` survived in this diagram long
    // after the feedback rip-down (#111) removed them from the registry.
    const named = [...originalDiagram.matchAll(/^\s{8,}(\w+)\["/gm)].map(m => m[1]).sort();
    const expected = getToolRegistry({ tier: 'admin' })
      .map(entry => entry.name)
      .sort();

    expect(named).toEqual(expected);
  });

  it('--check fails when a generated artifact drifts from the registry', () => {
    // Falsification: a gate nobody has watched fail is not a gate.
    fs.writeFileSync(TOOLS_MD_PATH, originalToolsMd.replace(/^\| `health_check` \|.*$/m, ''));
    expect(() =>
      execFileSync(process.execPath, [INVENTORY_GENERATOR, '--check'], {
        cwd: ROOT,
        env: generatorEnv(),
        stdio: 'pipe',
      })
    ).toThrow();

    fs.writeFileSync(TOOLS_MD_PATH, originalToolsMd);
    expect(() =>
      execFileSync(process.execPath, [INVENTORY_GENERATOR, '--check'], {
        cwd: ROOT,
        env: generatorEnv(),
        stdio: 'pipe',
      })
    ).not.toThrow();
  });
});
