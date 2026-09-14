/**
 * Shared category derivation rules for instruction classification.
 * Used by the embeddings dashboard and the groom remapCategories mode.
 * Order matters — first match wins.
 */

export const CATEGORY_RULES: [RegExp, string][] = [
  [/azure|arm-template|apim|batch|vmss/, 'Azure'],
  [/\bsf[-_]|service-fabric|servicefabric|collectsf|sfrp/, 'Service Fabric'],
  [/\bagent\b|agent[-_]/, 'Agent'],
  [/\bmcp\b|mcp[-_]/, 'MCP'],
  [/powershell|pwsh/, 'PowerShell'],
  [/vscode|vs-code|copilot/, 'VS Code'],
  [/\bai[-_]|\bml[-_]|\bllm\b|openai|gpt\d/, 'AI/ML'],
  [/\bgit[-_]|\brepo[-_]|github/, 'Git/Repo'],
  [/\btest|\bspec[-_]|vitest|playwright/, 'Testing'],
  [/kusto|\bkql\b/, 'Kusto'],
  [/dotnet|csharp/, '.NET'],
  [/mermaid/, 'Mermaid'],
  [/debug|troubleshoot/, 'Debugging'],
  [/docker|container/, 'Containers'],
  [/security|\bauth[-_]|authentication|secret-protection/, 'Security'],
  [/runbook|\bguide\b/, 'Runbooks/Guides'],
  [/\bgov[-_]|governance/, 'Governance'],
  [/\bicm[-_]|incident/, 'Operations'],
  [/onenote|markdown/, 'Documentation'],
];

/**
 * Optional index metadata consulted when the instruction ID alone matches no
 * rule. Structurally a subset of InstructionEntry, so an entry can be passed
 * directly.
 */
export interface CategoryMetadata {
  title?: string;
  primaryCategory?: string;
  categories?: string[];
}

/**
 * Apply CATEGORY_RULES to a single candidate string.
 *
 * Input is lowercased rather than adding the `i` flag to CATEGORY_RULES,
 * because those regexes are shared with groom remapCategories and must not
 * change matching semantics for other callers. IDs are already lowercase by
 * schema; titles are prose and categories are free-form slugs, so both need
 * folding.
 *
 * @param text Candidate string, or undefined/empty for "no signal".
 * @returns The matched display label, or undefined when nothing matched.
 */
function matchRules(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const lowered = text.toLowerCase();
  for (const [pattern, category] of CATEGORY_RULES) {
    if (pattern.test(lowered)) return category;
  }
  return undefined;
}

/**
 * Derive a display category for an instruction.
 *
 * Precedence is deterministic and deliberately puts the ID first: every
 * classification that was correct before metadata existed stays bit-identical,
 * and metadata only ever rescues entries that would otherwise be 'Other'.
 *
 * Issue #534 reported 29.9% 'Other' against a 1277-entry snapshot. Measured on
 * the live 263-entry index at the time of this change: 67.7% ID-only -> 16.3%
 * with metadata, 135 entries rescued and 0 previously-classified entries
 * relabelled. The residual is content the taxonomy has no rule for (CAD,
 * Fusion, CNC, verification), not misclassification — widening CATEGORY_RULES
 * is a separate decision from making classification metadata-aware.
 *
 *   1. instruction ID
 *   2. primaryCategory   — the governed, canonical field
 *   3. categories[]      — in array order, first match wins
 *   4. title             — prose, least authoritative
 *   5. 'Other'
 *
 * Metadata is matched THROUGH CATEGORY_RULES and never surfaced verbatim, so
 * the returned label is always one of the rule labels or 'Other'. A free-form
 * primaryCategory such as "performance" therefore yields 'Other', not a new
 * label: the dashboard legend and colour map are hand-maintained against a
 * closed set, and admitting arbitrary labels would permanently re-create the
 * uncoloured-category defect (#534 defect 2).
 *
 * @param id Instruction ID (compatibility path — this alone is the legacy behaviour).
 * @param meta Optional entry metadata; omit for ID-only derivation.
 * @returns A CATEGORY_RULES display label, or 'Other'.
 */
export function deriveCategory(id: string, meta?: CategoryMetadata): string {
  const fromId = matchRules(id);
  if (fromId) return fromId;
  if (!meta) return 'Other';

  const fromPrimary = matchRules(meta.primaryCategory);
  if (fromPrimary) return fromPrimary;

  for (const category of meta.categories ?? []) {
    const fromCategories = matchRules(category);
    if (fromCategories) return fromCategories;
  }

  return matchRules(meta.title) ?? 'Other';
}

/**
 * Convert a CATEGORY_RULES display label (e.g. "Service Fabric", "VS Code",
 * "AI/ML", ".NET", "Git/Repo") into a token that satisfies the disk schema's
 * category pattern (^[a-z0-9][a-z0-9-_]{0,48}$ — lowercase, hyphen/underscore
 * only, must start with [a-z0-9]).
 *
 * Used by groom remapCategories before writing primaryCategory to disk so the
 * loader-symmetric validator does not silently reject the rewrite.
 */
export function slugifyCategory(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // collapse runs of non-alphanumerics
    .replace(/^-+|-+$/g, '')     // strip leading/trailing hyphens
    .slice(0, 49);               // schema allows up to 49 chars
}
