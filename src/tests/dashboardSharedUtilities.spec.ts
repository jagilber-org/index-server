import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { escapeHtml } from '../dashboard/server/utils/escapeHtml.js';
import { validatePathContainment } from '../dashboard/server/utils/pathContainment.js';

describe('dashboard shared utilities', () => {
  it('escapes the five critical HTML characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('returns resolved paths that stay within the allowed base', () => {
    const base = path.resolve('C:\\repo\\docs');
    const filePath = path.join(base, 'panels', 'overview.md');

    expect(validatePathContainment(filePath, base)).toBe(path.resolve(filePath));
  });

  it('throws when a path escapes the allowed base', () => {
    const base = path.resolve('C:\\repo\\docs');
    const escaped = path.resolve(base, '..', 'secrets.txt');

    expect(() => validatePathContainment(escaped, base)).toThrow(/Path escapes allowed base:/);
  });
});
