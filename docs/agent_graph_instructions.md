# Agent Graph Utilization Guide (v1)

Purpose: Enable MCP-compatible agents (GPT-5, Claude, etc.) to leverage the index graph for high-relevance instruction retrieval, reasoning, and maintenance insights while minimizing protocol and performance overhead.

## 1. Mission

Use the instruction relationship graph to: (1) find the most relevant instructions for a user goal, (2) recommend structurally related content, (3) detect gaps/stale items, (4) operate efficiently (few tool calls, cache-aware).

## 2. Primary Tool

`graph_export` (JSON). Parameters:

- `enrich` (boolean) – upgrade nodes to schema v2 (categories, priority, status, usageCount, etc.)
- `includeCategoryNodes` (boolean) – materialize `category:<name>` nodes + enables `belongs` edges
- `includeEdgeTypes` (array) – subset of `primary | belongs | category`
- `maxEdges` (number, optional) – defensive cap

Never use Mermaid output for reasoning; it is visualization only.

## 3. Progressive Retrieval Strategy

1. Governance hash check (if available) → reuse cached graph if unchanged.
2. **Bootstrap**: `enrich=true&includeCategoryNodes=true&includeEdgeTypes=["primary"]`
3. Derive candidate categories & seed instructions from user intent or instruction search.
4. **Expand on demand**: fetch second graph with `includeEdgeTypes=["primary","belongs"]` only if deeper membership reasoning needed.
5. **Dense similarity (rare)**: only fetch `category` edges for a *small filtered subset* or very small Indexs; otherwise compute Jaccard similarity over category arrays locally.

## 4. Local Structures to Build

- Category index: `category -> instructionIds`
- Adjacency (instruction-only) from edges (ignore `category:` nodes for neighbor scoring)
- Node feature map: `{ usageCount, updatedAt, priorityTier, categories[] }`

## 5. Scoring Heuristic

```text
score = 0.5 * categoryOverlap + 0.25 * log(1 + usageCount) + 0.15 * recency + 0.10 * degreeCentrality
```
Normalize each term to [0,1]; redistribute weights if a feature is missing.

## 6. Similarity
Jaccard(categorySets): `|A∩B| / |A∪B|` – primary measure for overlap. Use to rank expansion candidates.

## 7. Recommendation Workflow

1. Parse user goal → extract thematic tokens.
2. Identify top categories by token frequency / semantic match.
3. Candidate set = union of instructions in top 1–3 categories (cap to reasonable N, e.g. 30).
4. Score & select top K (context-size aware). Provide bullet rationales.
5. If hash changed mid-session → invalidate cache, re-bootstrap.

## 8. Maintenance / Quality Signals

Report (feedback_submit) when:

- Orphan instruction (no categories / zero degree)
- High-degree outdated node (old updatedAt + high centrality)
- Category with excessive members but low aggregate usage
- Near duplicates (high category overlap + lexical similarity)

## 9. Efficiency / Safety Rules

- Never start with `includeEdgeTypes=["category"]`.
- Avoid repeated full enriched exports: hash-gate them.
- Prefer local similarity over requesting dense edges.
- Announce limitations if `meta.truncated` is true (partial knowledge).
- Do not surface entire raw graph to end user; summarize.

## 10. Failure Handling

If `graph_export` fails:

1. Retry once with `{ enrich:false, includeEdgeTypes:["primary"] }`.
2. Fallback to instruction search + category heuristics.
3. Explicitly disclose reduced reasoning basis.

## 11. Output Formatting (Agent → User)

- Header: summary of candidate space (e.g., "Examined 28 candidates; showing top 7 (scores 0.81–0.55)").
- Table/bullets: id | categories | score | rationale.
- Optional: improvement or gap suggestions.

graph_export { enrich:true, includeCategoryNodes:true, includeEdgeTypes:["primary"] }
graph_export { enrich:true, includeCategoryNodes:true, includeEdgeTypes:["primary","belongs"] }
## 12. Example Minimal Call Sequence

```text
# Bootstrap
graph_export { enrich:true, includeCategoryNodes:true, includeEdgeTypes:["primary"] }
# (Optional) Expand
graph_export { enrich:true, includeCategoryNodes:true, includeEdgeTypes:["primary","belongs"] }
```

## 13. Don’ts

- Don’t parse or rely on Mermaid text for reasoning.
- Don’t fetch huge pairwise `category` edges unless absolutely necessary and bounded.
- Don’t keep stale graph after index hash drift.
- Don’t conflate visualization edges with governance semantics.

## 14. Quick Self-Check Before Answer

- Current governance hash known? Cached graph matches? If not, refresh.
- Using minimal edge set needed? (Avoid over-fetch.)
- Ranked results have transparent rationales? 
- Any anomalies worth feedback submission?

## 15. Future Extensions (Optional)

- Local PageRank over `primary+belongs` subgraph.
- Diversity selection (maximize category spread subject to relevance).
- Drift diffing between two cached graphs for change announcements.

---
**Status:** Stable v1. Consider version bump when adding ranking formulas or new edge semantics.
