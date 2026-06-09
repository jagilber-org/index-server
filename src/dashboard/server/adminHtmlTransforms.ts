/**
 * adminHtmlTransforms — server-side transforms applied to the v2 admin
 * dashboard HTML (`src/dashboard/client/admin.html`) at render time.
 *
 * Currently exports `stripGraphTab`, which removes graph-tab markup and the
 * `admin.graph.js` script include when the graph feature flag is disabled.
 *
 * Extracted from the now-removed `legacyDashboardHtml.ts` (issue #230) so the
 * v2 admin route no longer transitively depends on legacy dashboard modules.
 *
 * NOTE: These regexes operate on dashboard HTML built from in-repo files and
 * trusted constants — never on user input. The patterns are intentional
 * targeted strips (matching specific data-section attributes, comment markers,
 * and the admin.graph.js script src) rather than a general HTML sanitizer.
 * CodeQL bad-tag-filter / incomplete-multi-character-sanitization queries are
 * suppressed for this surface via `.github/codeql/codeql-config.yml`.
 */

export function stripGraphTab(html: string): string {
  html = html.replace(/<button[^>]*data-section="graph"[^>]*>Graph<\/button>\s*/i, "");
  html = html.replace(/<!--\s*Graph Section\s*-->[\s\S]*?(?=<!--\s*Configuration Section\s*-->)/i, "");
  html = html.replace(/<script[^>]*src="js\/admin\.graph\.js[^"]*"[^>]*><\/script>\s*/i, "");
  return html;
}
