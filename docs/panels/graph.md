# Graph Panel

The Graph panel visualizes relationships between instructions in the index.

## Instruction Relationship Graph

An interactive graph showing how instructions relate to each other through shared categories, cross-references, and dependency links.

### Controls

- **Category Filter** — select categories to focus the graph on a subset
- **Instruction Filter** — select specific instructions to highlight
- **Format** — choose between JSON, DOT, or Mermaid output
- **Edge Types** — toggle `primary`, `category`, and `belongs` edge visibility
- **Enrich** — include usage statistics and governance data on nodes
- **Category Nodes** — show category grouping nodes in the graph

### Rendered Diagram

The Mermaid-rendered diagram provides a visual flowchart of instruction relationships. Nodes represent instructions, edges represent relationships.

### Reading the Graph

- **Solid lines** — direct cross-references between instructions
- **Dashed lines** — shared category membership
- **Node color** — indicates governance status (approved, draft, deprecated)
- **Node size** — reflects usage frequency

### MCP Tool

The graph data is produced by the `graph_export` tool:

```json
{"method": "graph_export", "params": {"format": "mermaid", "enrich": true}}
```

---

**Related docs:** [graph.md](/api/docs/graph), [architecture.md](/api/docs/overview)
