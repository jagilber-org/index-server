/**
 * Regression test: .pre-commit-config.yaml must parse without duplicate keys.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml = require('js-yaml') as { load: (s: string, opts?: Record<string, unknown>) => unknown };

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CONFIG = path.join(REPO_ROOT, '.pre-commit-config.yaml');

describe('.pre-commit-config.yaml structure', () => {
  it('parses under js-yaml (no duplicate keys)', () => {
    const text = readFileSync(CONFIG, 'utf8');
    expect(() => yaml.load(text, { json: false })).not.toThrow();
  });

  it('every hook block has at most one `stages:` key', () => {
    const text = readFileSync(CONFIG, 'utf8');
    const hookBlocks = text.split(/^\s*-\s+id:\s+/m);
    for (const block of hookBlocks.slice(1)) {
      const stagesLines = block
        .split(/\r?\n/)
        .filter((l) => /^\s+stages\s*:/.test(l));
      expect(stagesLines.length).toBeLessThanOrEqual(1);
    }
  });
});
