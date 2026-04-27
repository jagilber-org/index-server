import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const CLIENT_DIR = path.resolve(__dirname, '..', 'dashboard', 'client');

describe('Dashboard client security hardening', () => {
  it('keeps dashboard escapeHtml helpers encoding all five critical characters', () => {
    const utils = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'admin.utils.js'), 'utf8');
    const instructionsSrc = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'admin.instructions.js'), 'utf8');
    const html = fs.readFileSync(path.join(CLIENT_DIR, 'admin.html'), 'utf8');

    for (const src of [utils]) {
      expect(src).toContain(".replace(/&/g");
      expect(src).toContain(".replace(/</g");
      expect(src).toContain(".replace(/>/g");
      expect(src).toContain('.replace(/"/g');
      expect(src).toContain(".replace(/'/g");
    }

    expect(instructionsSrc).toContain('const escapeHtml = window.adminUtils.escapeHtml;');
    // admin.html uses a fallback pattern: (window.adminUtils && window.adminUtils.escapeHtml) || window.escapeHtml
    expect(html).toContain('window.adminUtils.escapeHtml');
  });

  it('sanitizes rendered markdown before inserting the instruction preview into the DOM', () => {
    const src = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'admin.instructions.js'), 'utf8');
    expect(src).toContain('function sanitizeHtmlFragment');
    expect(src).toContain('replaceWithSanitizedHtml(previewEl, marked.parse(body');
    expect(src).not.toContain('previewEl.innerHTML = marked.parse(body');
  });

  it('renders Mermaid output through a sanitizing helper instead of assigning svg text to innerHTML directly', () => {
    const src = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'admin.graph.js'), 'utf8');
    expect(src).toContain('function sanitizeGraphSvg');
    expect(src).toContain('function renderGraphSvg');
    expect(src).toContain('const SVG_ALLOWED_TAGS = new Map');
    expect(src).toContain('document.createElementNS');
    expect(src).not.toContain('document.importNode(parsed.documentElement, true)');
    expect(src).toContain('host.replaceChildren(safeSvg)');
    expect(src).not.toMatch(/innerHTML\s*=\s*svg/);
    expect(src).not.toMatch(/innerHTML\s*=\s*`/);
    expect(src).toMatch(/el\.innerHTML\s*=\s*''/g);
  });

  it('avoids inline handler interpolation when rendering instruction actions', () => {
    const instructionsSrc = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'admin.instructions.js'), 'utf8');
    const html = fs.readFileSync(path.join(CLIENT_DIR, 'admin.html'), 'utf8');

    expect(instructionsSrc).toContain('function wireInstructionListActions');
    expect(instructionsSrc).toContain('data-instruction-action="edit"');
    expect(instructionsSrc).not.toContain("onclick=\"editInstruction('${escapedName}')\"");
    expect(instructionsSrc).not.toContain("onclick=\"deleteInstruction('${escapedName}')\"");

    expect(html).toContain('function wireLegacyInstructionActions');
    expect(html).toContain('data-instruction-action="edit"');
    expect(html).not.toContain("onclick=\"editInstruction('${instr.name}')\"");
    expect(html).not.toContain("onclick=\"deleteInstruction('${instr.name}')\"");
  });

  it('escapes dynamic legacy admin.html innerHTML content before insertion', () => {
    const html = fs.readFileSync(path.join(CLIENT_DIR, 'admin.html'), 'utf8');
    expect(html).toContain('${normalized.issues.map(issue => `<li class="text-fail">${escapeHtml(issue)}</li>`).join(\'\')}');
    expect(html).toContain('${normalized.recommendations.map(rec => `<li class="text-warn">${escapeHtml(rec)}</li>`).join(\'\')}');
    expect(html).toContain('${escapeHtml(health.cpuTrend)}');
    expect(html).toContain('${escapeHtml(health.memoryTrend)}');
    expect(html).toContain('const safeMemoryGrowthRate = health.memoryGrowthRate');
    expect(html).toContain('escapeHtml(formatGrowthRate(health.memoryGrowthRate))');
  });

  it('builds inline dashboard metadata and diagnostics without templated innerHTML from dynamic values', () => {
    const html = fs.readFileSync(path.join(CLIENT_DIR, 'admin.html'), 'utf8');
    expect(html).toContain("buildBadge.className = 'build-badge';");
    expect(html).not.toContain('el.innerHTML = `Version <strong>${ver}</strong> ${commit} • Built ${bt}`');
    expect(html).not.toContain("diag.innerHTML = `Size: ${size} chars • Categories: ${cats} • Schema: ${schemaVer} ${changed?'<span class=\"text-warn\">(modified)</span>':''}`");
  });

  it('reuses the shared admin escapeHtml helper instead of redefining it in instructions UI', () => {
    const utils = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'admin.utils.js'), 'utf8');
    const instructions = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'admin.instructions.js'), 'utf8');

    expect(utils).toContain('window.adminUtils = Object.assign(window.adminUtils || {}, {');
    expect(utils).toContain('escapeHtml,');
    expect(instructions).toContain('const escapeHtml = window.adminUtils.escapeHtml;');
    expect(instructions).not.toContain('function escapeHtml(s) {');
  });
});
