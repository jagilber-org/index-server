# Graph Export Reference

`graph_export` exposes the instruction relationship graph for MCP clients,
agents, and the dashboard. It supports a minimal schema v1 response by default
and an enriched schema v2 response when `enrich:true` is requested.

## Enriched node metadata

When `enrich:true`, instruction nodes include metadata from the instruction
record so graph consumers can reason without fetching every entry separately.
Enriched instruction nodes may include:

- `nodeType: "instruction"`
- `categories`
- `primaryCategory`
- `priority`
- `priorityTier`
- `requirement`
- `owner`
- `status`
- `contentType`
- `createdAt`
- `updatedAt`
- `usageCount` when `includeUsage:true`

The `contentType` field is copied from instruction metadata and uses the
canonical content-type taxonomy defined by `schemas/instruction.schema.json`
and surfaced through `src/models/instruction.ts`.

Category nodes and non-enriched schema v1 nodes omit `contentType` by design.
Schema v1 remains the compatibility surface for minimal graph consumers.

## Example

```json
{
  "enrich": true,
  "includeCategoryNodes": true,
  "includeEdgeTypes": ["primary", "belongs"]
}
```

Enriched instruction node excerpt:

```json
{
  "id": "instr.alpha",
  "nodeType": "instruction",
  "categories": ["search", "docs"],
  "primaryCategory": "search",
  "status": "approved",
  "contentType": "integration"
}
```

See `docs/tools.md` for the full `graph_export` parameter and response shape,
and `schemas/graph-export-v2.schema.json` for the enriched response schema.
