import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const CLIENT_DIR = path.resolve(__dirname, '..', 'dashboard', 'client');

describe('Dashboard client security hardening', () => {
  it('sanitizes rendered markdown before inserting the instruction preview into the DOM', () => {
    const src = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'admin.instructions.js'), 'utf8');
    expect(src).toContain('function sanitizeHtmlFragment');
    expect(src).toContain('replaceWithSanitizedHtml(previewEl, marked.parse(body');
    expect(src).not.toContain('previewEl.innerHTML = marked.parse(body');
  });

  it('renders Mermaid output through a sanitizing helper instead of assigning svg text to innerHTML directly', () => {
    const src = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'admin.graph.js'), 'utf8');
    expect(src).toContain('function renderGraphSvg');
    expect(src).not.toMatch(/innerHTML\s*=\s*svg/);
  });

  it('builds inline dashboard metadata and diagnostics without templated innerHTML from dynamic values', () => {
    const html = fs.readFileSync(path.join(CLIENT_DIR, 'admin.html'), 'utf8');
    expect(html).toContain("buildBadge.className = 'build-badge';");
    expect(html).not.toContain('el.innerHTML = `Version <strong>${ver}</strong> ${commit} • Built ${bt}`');
    expect(html).not.toContain("diag.innerHTML = `Size: ${size} chars • Categories: ${cats} • Schema: ${schemaVer} ${changed?'<span class=\"text-warn\">(modified)</span>':''}`");
  });
});
