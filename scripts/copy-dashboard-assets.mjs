#!/usr/bin/env node
/**
 * Copies static dashboard client assets (HTML/CSS) from src to dist so
 * changes like new admin panel sections appear without manual copying.
 */
import { mkdirSync, readdirSync, copyFileSync, statSync, readFileSync } from 'fs';
import { join, extname } from 'path';
import { createHash } from 'crypto';

const srcDir = join(process.cwd(), 'src', 'dashboard', 'client');
const destDir = join(process.cwd(), 'dist', 'dashboard', 'client');

// Allow JS so we can bundle local third-party dashboard helpers (e.g. layout-elk UMD)
const allowed = new Set(['.html', '.css', '.js']);

function fileHash(p) {
  try {
    const h = createHash('sha1');
    h.update(readFileSync(p));
    return h.digest('hex');
  } catch {
    return '';
  }
}

function ensureDir(p) {
  try { mkdirSync(p, { recursive: true }); } catch { /* noop ensure */ }
}

function copyAssets() {
  ensureDir(destDir);
  let copied = 0;
  const debug = [];

  /**
   * Recursively walk src dashboard client tree and copy allowed file types
   * preserving relative structure (so js/*.js modules load in dist).
   */
  function walk(currentSrc, currentDest) {
    ensureDir(currentDest);
    const entries = readdirSync(currentSrc, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(currentSrc, entry.name);
      const destPath = join(currentDest, entry.name);
      if (entry.isDirectory()) {
        // Only recurse into known safe directories (js, css) to avoid copying build artifacts accidentally
        if (/^(js|css)$/i.test(entry.name)) {
          walk(srcPath, destPath);
        }
        continue;
      }
      const ext = extname(entry.name).toLowerCase();
      if (!allowed.has(ext)) continue;
      try {
        const srcStat = statSync(srcPath);
        let needsCopy = true;
        let reason = 'new';
        try {
          const destStat = statSync(destPath);
          if (destStat.size === srcStat.size) {
            const srcH = fileHash(srcPath);
            const destH = fileHash(destPath);
            if (srcH === destH) {
              needsCopy = false;
              reason = 'unchanged';
            } else {
              reason = 'hash-diff';
            }
          } else {
            reason = 'size-diff';
          }
        } catch { reason = 'missing-dest'; }
        if (needsCopy) {
          copyFileSync(srcPath, destPath);
          copied++;
          debug.push(`${destPath.replace(process.cwd()+"/", '')}: copied (${reason})`);
        } else {
          debug.push(`${destPath.replace(process.cwd()+"/", '')}: skipped (${reason})`);
        }
      } catch (e) {
        console.error('Failed to copy', srcPath, e.message);
      }
    }
  }

  walk(srcDir, destDir);

  console.log(`[copy-dashboard-assets] Copied ${copied} asset(s) (recursive). Details: ${debug.join('; ')}`);
  if (!copied) {
    console.log('[copy-dashboard-assets] NOTE: 0 assets copied (all unchanged by hash).');
  }

  // Bundle @mermaid-js/layout-elk ESM build for offline usage (entry point + chunks).
  try {
    const elkDistDir = join(process.cwd(), 'node_modules', '@mermaid-js', 'layout-elk', 'dist');
    const elkPkgPath = join(elkDistDir, 'mermaid-layout-elk.esm.min.mjs');
    const elkDest = join(destDir, 'mermaid-layout-elk.esm.min.mjs');
    copyFileSync(elkPkgPath, elkDest);
    // Copy chunks/ subdirectory that the entry point dynamically imports
    const chunksSubDir = join(elkDistDir, 'chunks', 'mermaid-layout-elk.esm.min');
    const chunksDestDir = join(destDir, 'chunks', 'mermaid-layout-elk.esm.min');
    try {
      ensureDir(chunksDestDir);
      for (const f of readdirSync(chunksSubDir)) {
        if (f.endsWith('.mjs')) {
          copyFileSync(join(chunksSubDir, f), join(chunksDestDir, f));
        }
      }
    } catch (ce) {
      console.warn('[copy-dashboard-assets] WARN: could not copy layout-elk chunks/', ce.message);
    }
    console.log('[copy-dashboard-assets] Added local mermaid-layout-elk.esm.min.mjs + chunks');
  } catch (e) {
    console.warn('[copy-dashboard-assets] WARN: could not copy layout-elk ESM build (package missing?)', e.message);
  }

  // Bundle mermaid.min.js from node_modules for offline usage.
  try {
    const mermaidSrc = join(process.cwd(), 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
    const mermaidDest = join(destDir, 'js', 'mermaid.min.js');
    copyFileSync(mermaidSrc, mermaidDest);
    console.log('[copy-dashboard-assets] Added local mermaid.min.js');
  } catch (e) {
    console.warn('[copy-dashboard-assets] WARN: could not copy mermaid.min.js (package missing?)', e.message);
  }

  // Bundle elkjs from node_modules for offline usage.
  try {
    const elkjsSrc = join(process.cwd(), 'node_modules', 'elkjs', 'lib', 'elk.bundled.js');
    const elkjsDest = join(destDir, 'js', 'elk.bundled.js');
    copyFileSync(elkjsSrc, elkjsDest);
    console.log('[copy-dashboard-assets] Added local elk.bundled.js');
  } catch (e) {
    console.warn('[copy-dashboard-assets] WARN: could not copy elk.bundled.js (package missing?)', e.message);
  }

  // Lightweight cache-busting: append ?v=<pkgVersion-sha1(admin.css)> to script & css references in admin.html (dist copy only)
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    const adminHtmlPath = join(destDir, 'admin.html');
    let html = readFileSync(adminHtmlPath, 'utf8');
    const version = pkg.version || '0.0.0';
    // build content hash from css + js files to change when any asset changes even if version not bumped
    let contentHash = '';
    try {
      const h = createHash('sha1');
      try { h.update(readFileSync(join(destDir, 'css', 'admin.css'))); } catch { /* ignore */ }
      const jsDir = join(destDir, 'js');
      try { for (const f of readdirSync(jsDir).sort()) { if (f.endsWith('.js')) h.update(readFileSync(join(jsDir, f))); } } catch { /* ignore */ }
      try { h.update(readFileSync(join(destDir, 'admin.html'))); } catch { /* ignore */ }
      contentHash = h.digest('hex').slice(0,8);
    } catch { /* ignore hash calc */ }
    const stamp = `${version}-${contentHash}`;
    // Replace existing query (if present) or append
    html = html.replace(/(css\/admin\.css)(?:\?v=[A-Za-z0-9.-]+)?/,'$1?v='+stamp);
    html = html.replace(/(js\/admin\.[a-zA-Z0-9_.-]+\.js)(?:\?v=[A-Za-z0-9.-]+)?/g,'$1?v='+stamp);
    // Inject meta for runtime verification (idempotent)
    if(!/meta name="dashboard-build-version"/.test(html)){
      html = html.replace(/<head>/,'<head>\n    <meta name="dashboard-build-version" content="'+stamp+'">');
    }
  // Overwrite in place
  copyFileSync(adminHtmlPath, adminHtmlPath); // no-op ensure
  import('fs').then(fsMod => { try { fsMod.writeFileSync(adminHtmlPath, html); } catch(e2){ console.warn('[copy-dashboard-assets] write failed', e2.message); } });
    console.log('[copy-dashboard-assets] Applied cache-busting query stamp', stamp);
  } catch(e) {
    console.warn('[copy-dashboard-assets] Cache-busting patch skipped:', e.message);
  }
}

copyAssets();
