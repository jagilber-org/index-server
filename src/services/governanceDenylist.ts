/**
 * Governance denylist — single source of truth (#494).
 *
 * The loader refuses to ingest governance/specification seed artifacts so the
 * catalog cannot recursively index its own bootstrap material. The write path
 * must apply the same rule, otherwise `index_add` / `index_import` persist a
 * file that silently disappears on the next load.
 */

/** Basename prefixes that must never become live instructions. */
const DENIED_ID_PREFIXES = ['000-bootstrapper', '001-lifecycle-bootstrap'] as const;

export const GOVERNANCE_DENYLIST_REASON = 'ignored:governance-denylist';

/** True when an instruction id would be denied by the loader. */
export function isGovernanceDeniedId(id: string): boolean {
  const lower = String(id || '').toLowerCase();
  if (DENIED_ID_PREFIXES.some(p => lower.startsWith(p))) return true;
  return lower.includes('.governance.') || lower === 'constitution';
}

/** True when a filename in the instruction directory would be denied by the loader. */
export function isGovernanceDeniedBasename(basename: string): boolean {
  const lower = String(basename || '').toLowerCase();
  if (DENIED_ID_PREFIXES.some(p => lower.startsWith(p))) return true;
  return lower.includes('.governance.') || lower === 'constitution.json';
}

export function governanceDenylistError(id: string): string {
  return `denylisted_id: "${id}" matches a governance seed pattern and would be refused by the loader, so it can never appear in the index. Choose a different id; use help_overview for onboarding content.`;
}
