/**
 * Onboarding / Help Handlers
 *
 * Provides a stable read-only tool 'help_overview' that returns structured
 * onboarding guidance so a naive / first-time agent can self-bootstrap:
 * - Discover tools & their purpose
 * - Understand local (P0) vs indexed (P1+) lifecycle & promotion workflow
 * - Learn safe mutation override pattern (INDEX_SERVER_MUTATION)
 * - Follow a deterministic promotion checklist
 * - Avoid governance/spec recursion (documents intentionally NOT ingested)
 */
import { registerHandler } from '../server/registry';
import { getToolRegistry } from './toolRegistry';
import { getIndexState } from './indexContext';

const HELP_VERSION = '2026-05-20';

interface OverviewSection {
  id: string; title: string; content: string; bullets?: string[]; nextActions?: string[];
}

function buildSections(): OverviewSection[] {
  return [
    {
      id: 'intro',
      title: 'Welcome',
      content: 'This server exposes a governance-aware instruction index and supporting MCP tools. Use this overview to learn discovery, lifecycle tiers, and safe promotion patterns.'
    },
    {
      id: 'client-activation',
      title: 'VS Code Client Tool Naming (READ FIRST)',
      content: 'In VS Code / Copilot Chat, MCP tools are exposed under their full prefixed name: mcp_index-server_<tool>. Short aliases (index_search, index_add, index_dispatch, bootstrap) are NOT callable names in the VS Code tool registry — they are only the underlying MCP tool ids returned by tools/list. Calling tool_search for a short alias will return zero hits even when the full tool is already live; that is NOT evidence the tool is missing.',
      bullets: [
        'Callable from VS Code: mcp_index-server_help_overview, mcp_index-server_bootstrap, mcp_index-server_index_search, mcp_index-server_index_add, mcp_index-server_index_dispatch, mcp_index-server_index_schema, mcp_index-server_index_health, mcp_index-server_index_governanceHash, mcp_index-server_index_remove, mcp_index-server_index_reload, mcp_index-server_promote_from_repo, mcp_index-server_usage_track, mcp_index-server_usage_hotset, mcp_index-server_feedback_submit, mcp_index-server_feedback_manage, mcp_index-server_messaging_* (send/get/list_channels/read/ack/purge/reply/stats/thread/update), mcp_index-server_metrics_snapshot, mcp_index-server_health_check, mcp_index-server_gates_evaluate, mcp_index-server_graph_export, mcp_index-server_integrity_verify, mcp_index-server_prompt_review',
        'tool_search is a discovery aid for the deferred pool; query with descriptions ("instruction index search", "feedback submit"), not bare tool names',
        'If tool_search returns zero for a shorthand name, FIRST try calling the full mcp_index-server_<name> directly — it is almost certainly already exposed',
        'The set of currently-exposed tools can change between turns (VS Code rotates the deferred pool); the prefixed name remains the same',
        'Non-VS-Code clients (raw MCP, claude-cli) see all tools immediately from tools/list with their bare ids (index_search, index_add, etc.)'
      ],
      nextActions: [
        'Try the full prefixed name FIRST (e.g. mcp_index-server_index_search) before concluding a tool is missing',
        'Only fall back to tool_search with descriptive phrases if the call fails with "tool not found"',
        'Never report "tool unreachable" without first attempting the full mcp_index-server_* name'
      ]
    },
    {
      id: 'discovery',
      title: 'Tool Discovery Flow',
      content: 'After client-side activation (see above), initialize the protocol and enumerate capabilities via meta_tools or tools/list. Call help_overview for structured guidance before attempting mutations.',
      bullets: [
        'initialize → tools/call meta_tools → tools/call help_overview',
        'index_dispatch (action=list) to enumerate index entries',
        'index_schema for instruction JSON schema + examples + validation rules',
        'index_governanceHash for deterministic governance projection',
        'index_health to assess drift & recursionRisk'
      ],
      nextActions: ['Call meta_tools', 'Call help_overview', 'Call index_schema', 'List index via index_dispatch {action:list}']
    },
    {
      id: 'lifecycle',
      title: 'Lifecycle Tiers',
      content: 'Instructions progress from local experimental (P0) to indexed stable (P1+) via explicit promotion. Governance documents (constitution, specs) are excluded from ingestion to prevent recursion.',
      bullets: [
        'P0 Local: workspace-specific, rapid iteration, not shareable',
        'P1 Indexed: canonical, versioned, governance-compliant',
        'Higher tiers (P2+): optional refinement / broader distribution',
        'Denylist prevents governance/spec ingestion (see recursionRisk metric)'
      ]
    },
    {
      id: 'promotion',
      title: 'Promotion Checklist',
      content: 'Before promoting a P0 instruction to index ensure quality, clarity, and uniqueness benchmarks are satisfied.',
      bullets: [
        'Clarity: concise title + semantic summary',
        'Accuracy: verified against current repo state',
        'Value: non-duplicative & materially helpful',
        'Maintainability: minimal volatile references',
        'Classification & priorityTier assigned',
        'Owner + review cadence set (lastReviewedAt/nextReviewDue)',
        'ChangeLog initialized if version > 1'
      ],
      nextActions: ['Run prompt_review for large bodies', 'Run integrity_verify', 'Submit via index_add']
    },
    {
      id: 'mutation-safety',
      title: 'Safe Mutation',
      content: 'Write operations are enabled by default, but bootstrap confirmation and reference mode still gate risky changes. Set INDEX_SERVER_MUTATION=0 when you need an explicit read-only runtime.'
    },
    {
      id: 'feedback',
      title: 'Feedback Reporting',
      content: 'Use feedback_submit to report tool failures, documentation gaps, defects, and feature requests. Minimum required fields are type, severity, title, and description.',
      bullets: [
        'feedback_submit required: type, severity, title, description',
        'type examples: issue, bug-report, feature-request, security, status-report',
        'severity values: low, medium, high, critical',
        'Use description for the report body; message is not a feedback_submit field'
      ],
      nextActions: ['Call feedback_submit with {type,severity,title,description}', 'Use feedback_manage {action:list} to review submitted entries']
    },
    {
      id: 'recursion-safeguards',
      title: 'Recursion Safeguards',
      content: 'Loader denylist excludes governance/spec seeds. index_health exposes recursionRisk and leakage metrics; expected value is recursionRisk=none.'
    },
    {
      id: 'next-steps',
      title: 'Suggested Next Steps',
      content: 'Follow these steps to integrate effectively.',
      bullets: [
        '1. Fetch meta_tools and record stable tools',
        '2. Call index_schema for instruction format guidance',
        '3. List index entries (index_dispatch list)',
        '4. Track usage for relevant instructions (usage_track)',
        '5. Draft local P0 improvements in a separate directory',
        '6. Evaluate with prompt_review & integrity_verify',
        '7. Promote via index_add (with mutation enabled)' ,
        '8. Monitor drift via index_health and governanceHash'
      ]
    }
  ];
}

registerHandler('help_overview', () => {
  const registry = getToolRegistry({ tier: 'admin' }).map(t => t.name);
  const idx = getIndexState();
  return {
    generatedAt: new Date().toISOString(),
    version: HELP_VERSION,
    summary: 'Structured onboarding guidance for new agents: discovery → lifecycle → promotion → safety.',
    sections: buildSections(),
    toolDiscovery: {
      primary: registry.filter(n => !n.startsWith('diagnostics/')),
      diagnostics: registry.filter(n => n.startsWith('diagnostics/'))
    },
    lifecycleModel: {
      tiers: [
        { tier: 'P0', purpose: 'Local experimental / workspace-scoped, not indexed' },
        { tier: 'P1', purpose: 'Indexed baseline, governance compliant' },
        { tier: 'P2', purpose: 'Refined / broader consumption (optional)' }
      ],
      promotionChecklist: [
        'Ensure uniqueness (no near-duplicate id/body)',
        'Provide semantic summary & owner',
        'Assign priorityTier & classification',
        'Set review dates',
        'Pass integrity_verify and governanceHash stable'
      ]
    },
    index: { count: idx.list.length, hash: idx.hash }
  };
});
