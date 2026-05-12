/**
 * Canonical MCP protocol enum tuples shared across handlers, the tool registry
 * (JSON Schema), and the Zod registry. All consumers MUST import these tuples —
 * do not hand-copy the values. Drift is detected by the SOT scanner test.
 */

/** usage_track.action — what the agent did with the instruction. */
export const USAGE_ACTIONS = ['retrieved', 'applied', 'cited'] as const;
export type UsageAction = (typeof USAGE_ACTIONS)[number];

/** usage_track.signal — qualitative outcome reported by the agent. */
export const USAGE_SIGNALS = ['helpful', 'not-relevant', 'outdated', 'applied'] as const;
export type UsageSignal = (typeof USAGE_SIGNALS)[number];

/** index_search.mode — search strategy. */
export const SEARCH_MODES = ['keyword', 'regex', 'semantic'] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

/** Tool registry visibility tier. */
export const TOOL_TIERS = ['core', 'extended', 'admin'] as const;
export type ToolTier = (typeof TOOL_TIERS)[number];
