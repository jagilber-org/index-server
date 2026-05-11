/**
 * Builds the canonical "content model" seed (002-content-model) from the
 * authoritative instruction JSON schema at module-load time.
 *
 * Single source of truth: the schema. The body here is regenerated on every
 * server start, so any change to the schema's `contentType.enum`, its
 * description, the top-level `required` array, or referenced field
 * descriptions automatically flows into the seed. A drift test
 * (src/tests/contentModelSeed.spec.ts) enforces the wiring.
 *
 * Constraint (constitution A-7): generalized, public-safe, environment-agnostic.
 */
import schema from '../../schemas/instruction.schema.json';

interface SchemaShape {
  required: string[];
  properties: Record<string, { description?: string; enum?: string[] }>;
}

interface ContentTypeMatrixRow {
  value: string;
  description: string;
}

/**
 * Parse the `contentType` schema description for `<name> (<desc>)` fragments
 * and filter to the canonical enum members.
 */
function parseContentTypeMatrix(s: SchemaShape): ContentTypeMatrixRow[] {
  const ct = s.properties.contentType;
  if (!ct || !Array.isArray(ct.enum) || typeof ct.description !== 'string') {
    throw new Error('content-model seed: schema is missing properties.contentType.enum or .description');
  }
  const enumSet = new Set(ct.enum);
  const rows: ContentTypeMatrixRow[] = [];
  const seen = new Set<string>();
  const re = /([a-z][a-z-]*) \(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ct.description)) !== null) {
    const value = m[1];
    const description = m[2].trim();
    if (!enumSet.has(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    rows.push({ value, description });
  }
  // Guarantee every enum member appears even if the description prose drifts.
  for (const v of ct.enum) {
    if (!seen.has(v)) rows.push({ value: v, description: '(no description in schema)' });
  }
  // Stable order: schema enum order
  rows.sort((a, b) => ct.enum!.indexOf(a.value) - ct.enum!.indexOf(b.value));
  return rows;
}

function fieldBullet(fieldName: string, s: SchemaShape): string {
  const desc = s.properties[fieldName]?.description;
  if (!desc) {
    throw new Error(`content-model seed: schema property '${fieldName}' has no description`);
  }
  return `- \`${fieldName}\` — ${desc}`;
}

/**
 * Common optional fields surfaced to agents. Order is curated for narrative
 * flow; the *descriptions* are pulled from the schema so the seed cannot
 * drift from `index_schema`. Adding/removing entries here is a deliberate
 * editorial choice, but the prose is never duplicated.
 */
const COMMON_OPTIONAL_FIELDS = [
  'priorityTier',
  'semanticSummary',
  'primaryCategory',
  'owner',
  'classification',
  'version',
  'status',
  'reviewIntervalDays',
  'lastReviewedAt',
  'nextReviewDue',
  'rationale'
];

function readSchemaVersion(s: SchemaShape): string {
  const sv = s.properties.schemaVersion;
  if (!sv || !Array.isArray(sv.enum) || sv.enum.length === 0) {
    throw new Error('content-model seed: schema.properties.schemaVersion.enum is missing or empty');
  }
  // Pick the highest enum value (strings compared numerically when possible).
  const sorted = [...sv.enum].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return nb - na;
    return b.localeCompare(a);
  });
  return sorted[0];
}

/**
 * Build the canonical seed object for `002-content-model` from the schema.
 *
 * The function is pure: same schema input → same seed output. Tests rely on
 * this determinism to assert drift-safety.
 *
 * @returns Canonical seed `{ file, id, json }` ready to push into CANONICAL_SEEDS.
 */
export function buildContentModelSeed(): { file: string; id: string; json: Record<string, unknown> } {
  const s = schema as unknown as SchemaShape;
  if (!Array.isArray(s.required) || s.required.length === 0) {
    throw new Error('content-model seed: schema.required is missing or empty');
  }
  const matrix = parseContentTypeMatrix(s);
  const requiredLines = s.required.map(f => fieldBullet(f, s)).join('\n');
  const optionalLines = COMMON_OPTIONAL_FIELDS.map(f => fieldBullet(f, s)).join('\n');
  const matrixRows = matrix
    .map(r => `| \`${r.value}\` | ${r.description} |`)
    .join('\n');
  const schemaVersionValue = readSchemaVersion(s);

  const body = `# Index Server Content Model

Knowledge for AI agents writing or evaluating instruction entries. This document is regenerated from the canonical \`schemas/instruction.schema.json\` on every server start, so it always matches the validator the index actually runs.

For the full machine-validatable schema (with current ranges, runtime limits, and the promotion-workflow checklist) call the \`index_schema\` MCP tool. Treat that tool as the validation source of truth at runtime; this seed is the conceptual knowledge guide.

## Required fields

Every instruction entry must include:

${requiredLines}

## \`contentType\` decision matrix

Pick the \`contentType\` that matches what the entry is for:

| Value | Use when |
|-------|----------|
${matrixRows}

Default is \`instruction\`.

## Common optional fields

${optionalLines}

Call \`index_schema\` for the authoritative list, validation rules, and minimal example.

## Note on adjacent concepts

Some agent platforms use terms such as plugin, MCP server, or connector for deployment surfaces. When documenting those surfaces in Index Server, choose the canonical \`contentType\` by purpose: external system guidance is \`integration\`, reusable context is \`knowledge\`, a callable capability is \`skill\`, and a multi-step process is \`workflow\`.
`;

  return {
    file: '002-content-model.json',
    id: '002-content-model',
    json: {
      id: '002-content-model',
      title: 'Index Server Content Model & Field Reference',
      body,
      audience: 'all',
      requirement: 'recommended',
      priority: 95,
      priorityTier: 'P1',
      contentType: 'knowledge',
      categories: ['bootstrap', 'content-model', 'reference', 'schema'],
      primaryCategory: 'reference',
      owner: 'system',
      version: '1.0.0',
      schemaVersion: schemaVersionValue,
      semanticSummary:
        'Knowledge for AI agents: required fields, the contentType decision matrix, and pointer to index_schema for the live JSON schema.'
    }
  };
}
