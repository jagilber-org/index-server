/**
 * Dashboard Client Bug Fixes - TDD Tests
 *
 * Tests for bugs discovered during dashboard DevTools testing:
 * - bug-3: Overview fetches /api/maintenance (should be /api/admin/maintenance)
 * - bug-5: Instruction category dropdown has duplicate entries
 * - bug-6: Instructions tab fetches /api/instructions/categories (should be /api/instructions_categories)
 * - bug-7: Graph debug stage string visible in UI
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const CLIENT_DIR = path.resolve(__dirname, '..', 'dashboard', 'client');

describe('Dashboard Client Bug Fixes', () => {
  describe('bug-8: Backup file export/import format mismatch', () => {
    it('should preserve zip export filenames instead of forcing a .json download', () => {
      const src = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'admin.maintenance.js'), 'utf8');
      expect(src).not.toContain("a.download = id + '.json'");
      expect(src).toContain('content-disposition');
      expect(src).toContain('getDownloadFilename');
    });

    it('should allow zip backup imports and detect zip payloads by content', () => {
      const html = fs.readFileSync(path.join(CLIENT_DIR, 'admin.html'), 'utf8');
      const src = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'admin.maintenance.js'), 'utf8');

      expect(html).toContain('accept=".json,.zip,application/zip"');
      expect(src).toContain('application/zip');
      expect(src).toContain('X-Backup-Filename');
      expect(src).toContain('looksLikeZip');
      expect(src).toContain('arrayBuffer()');
    });
  });

  describe('bug-3: Overview maintenance endpoint', () => {
    it('should use /api/admin/maintenance, not /api/maintenance', () => {
      const src = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'admin.overview.js'), 'utf8');
      // Must NOT contain bare /api/maintenance (without /admin/)
      const badPattern = /fetch\s*\(\s*['"`]\/api\/maintenance['"`]/;
      expect(src).not.toMatch(badPattern);
      // Must contain the correct endpoint
      expect(src).toContain('/api/admin/maintenance');
    });
  });

  describe('bug-6: Instruction categories endpoint', () => {
    it('should use /api/instructions_categories, not /api/instructions/categories', () => {
      const src = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'admin.instructions.js'), 'utf8');
      // Must NOT contain the wrong route
      const badPattern = /fetch\s*\(\s*['"`]\/api\/instructions\/categories['"`]/;
      expect(src).not.toMatch(badPattern);
      // Must contain the correct underscore-separated route
      expect(src).toContain('/api/instructions_categories');
    });
  });

  describe('bug-5: Category dropdown deduplication', () => {
    it('should clear dropdown before appending fallback categories', () => {
      const src = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'admin.instructions.js'), 'utf8');
      // The fallback category population (when catNames.length is 0)
      // must reset innerHTML before appending options to avoid duplicates
      // Look for the fallback block that does select.appendChild
      // It should have an innerHTML reset before forEach
      const fallbackBlock = src.match(/if\s*\(\s*!catNames\.length\s*\)/);
      expect(fallbackBlock).toBeTruthy();

      // After the fallback condition, innerHTML should be reset before appending
      const afterFallback = src.slice(src.indexOf('if(!catNames.length)'));
      expect(afterFallback).toMatch(/innerHTML\s*=.*All Categories/);
    });
  });

  describe('bug-2: Syntax error in admin.utils.js', () => {
    it('should not have eslint-disable wrapped in parentheses', () => {
      const src = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'admin.utils.js'), 'utf8');
      // Must NOT start with (/* eslint-disable */) — parens make it a syntax error
      expect(src).not.toMatch(/^\(\/\*.*\*\/\)/);
    });
  });

  describe('bug-7: Graph debug stage string visibility', () => {
    it('should not show debug stage markers to users', () => {
      const _src = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'admin.graph.js'), 'utf8');
      // The setGraphMetaProgress function writes debug [stage:...] markers
      // to a visible element. These should be hidden or use a hidden element.
      // Check that the meta element has display:none or is otherwise hidden
      // OR that the stage markers are only written to console, not DOM
      const html = fs.readFileSync(path.join(CLIENT_DIR, 'admin.html'), 'utf8');

      // The graph-meta2 or graph-meta element should have hidden/display:none styling
      // OR setGraphMetaProgress should not write to visible DOM
      const hasHiddenMeta = html.includes('graph-meta2') &&
        (html.match(/id=["']graph-meta2["'][^>]*style=["'][^"']*display:\s*none/) ||
         html.match(/id=["']graph-meta2["'][^>]*hidden/) ||
         html.match(/id=["']graph-meta2["'][^>]*class=["'][^"']*sr-only/));
      const cssContent = fs.readFileSync(path.join(CLIENT_DIR, 'css', 'admin.css'), 'utf8');
      const hasHiddenMetaCSS = cssContent.includes('.graph-meta2') &&
        !!cssContent.match(/\.graph-meta2[^{]*\{[^}]*display:\s*none/);

      expect(hasHiddenMeta || hasHiddenMetaCSS).toBeTruthy();
    });
  });
});
