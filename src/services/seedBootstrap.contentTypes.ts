import schema from '../../schemas/instruction.schema.json';

interface SchemaShape {
  properties: Record<string, { description?: string; enum?: string[] }>;
}

interface ContentTypeRow {
  value: string;
  description: string;
}

function contentTypeRows(s: SchemaShape): ContentTypeRow[] {
  const ct = s.properties.contentType;
  if (!ct || !Array.isArray(ct.enum) || typeof ct.description !== 'string') {
    throw new Error('content-types seed: schema is missing properties.contentType.enum or .description');
  }
  const rows: ContentTypeRow[] = [];
  const seen = new Set<string>();
  const enumSet = new Set(ct.enum);
  const re = /([a-z][a-z-]*) \(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ct.description)) !== null) {
    const value = m[1];
    if (!enumSet.has(value) || seen.has(value)) continue;
    seen.add(value);
    rows.push({ value, description: m[2].trim() });
  }
  for (const value of ct.enum) {
    if (!seen.has(value)) rows.push({ value, description: '(no description in schema)' });
  }
  rows.sort((a, b) => ct.enum!.indexOf(a.value) - ct.enum!.indexOf(b.value));
  return rows;
}

function readSchemaVersion(s: SchemaShape): string {
  const sv = s.properties.schemaVersion;
  if (!sv || !Array.isArray(sv.enum) || sv.enum.length === 0) {
    throw new Error('content-types seed: schema.properties.schemaVersion.enum is missing or empty');
  }
  return [...sv.enum].sort((a, b) => Number(b) - Number(a))[0];
}

export function buildContentTypesSeed(): { file: string; id: string; json: Record<string, unknown> } {
  const s = schema as unknown as SchemaShape;
  const matrixRows = contentTypeRows(s)
    .map(r => `| \`${r.value}\` | ${r.description} |`)
    .join('\n');

  const body = `# Index Server Content Types

This knowledge seed lists the canonical \`contentType\` taxonomy from \`schemas/instruction.schema.json\`. It is regenerated from the schema on every server start so agents see the same enum values the validator enforces.

For the full machine-validatable schema, call the \`index_schema\` MCP tool.

| Value | Use when |
|-------|----------|
${matrixRows}

Default is \`instruction\`.
`;

  return {
    file: '003-content-types.json',
    id: '003-content-types',
    json: {
      id: '003-content-types',
      title: 'Index Server Content Types',
      body,
      audience: 'all',
      requirement: 'recommended',
      priority: 94,
      priorityTier: 'P1',
      contentType: 'knowledge',
      categories: ['bootstrap', 'content-types', 'schema'],
      primaryCategory: 'schema',
      owner: 'system',
      version: '1.0.0',
      schemaVersion: readSchemaVersion(s),
      semanticSummary: 'Canonical Index Server contentType taxonomy generated from instruction.schema.json.',
    },
  };
}
