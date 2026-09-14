# Graph Panel

The Graph panel visualizes relationships between instructions in the index.

## Instruction Relationship Graph

An interactive graph showing how instructions relate to each other through shared categories and structured links.

### Controls

- **Category Filter** — select categories to focus the graph on a subset
- **Instruction Filter** — select specific instructions to highlight
- **Format** — choose between JSON, DOT, or Mermaid output
- **Edge Types** — toggle `primary`, `category`, `belongs`, and `link` edge visibility
- **Enrich** — include usage statistics and governance data on nodes
- **Category Nodes** — show category grouping nodes in the graph

### Rendered Diagram

The Mermaid-rendered diagram provides a visual flowchart of instruction relationships. Nodes represent instructions, edges represent relationships.

### Edge Types

The graph contains two families of edges:

**Category-based edges** (existing since schema v1):

| Edge type | Meaning |
|-----------|---------|
| `primary` | Instruction to its `primaryCategory` |
| `category` | Pairwise edge between instructions that share a category |
| `belongs` | Instruction to a category node (enriched mode with `includeCategoryNodes` only) |

**Link-based edges** (schema v8):

| Edge type | Meaning |
|-----------|---------|
| `link` | Instruction-to-instruction edge derived from the entry's `links` array |

Link edges carry `rel` and `label` metadata from the source link. In enriched
mode, inverse edges are materialized at export time (not stored) so that
consumers can traverse relationships in both directions.

### Link Relationship Types

Each link in an entry's `links` array has an optional `rel` field (default: `related`):

| `rel` value | Semantics | Inverse edge (enriched mode) |
|-------------|-----------|------------------------------|
| `related` | General association | Bidirectional (A<->B) |
| `prerequisite` | A requires B | B is required by A |
| `sequel` | A precedes B | B follows A |
| `part-of` | A is part of B | B contains A |
| `see-also` | Informational reference | Directed only (A->B) |

Inverse edges carry `inverse: true` metadata so consumers can distinguish
stored edges from derived edges.

### Reading the Graph

- **Category edges** — shared category membership and primary category assignment
- **Link edges** — explicit cross-references between instructions (with `rel` and optional `label`)
- **Node color** — indicates governance status (approved, draft, deprecated)
- **Node size** — reflects usage frequency

### MCP Tool

The graph data is produced by the `graph_export` tool:

```json
{"method": "graph_export", "params": {"format": "mermaid", "enrich": true}}
```

---

**Related docs:** [architecture.md](/api/docs/overview), [tools.md](../tools.md)
