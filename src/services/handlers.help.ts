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

const HELP_VERSION = '2025-09-14';

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
      id: 'discovery',
      title: 'Tool Discovery Flow',
      content: 'Initialize (initialize), then enumerate capabilities via meta_tools or tools/list. Call help_overview for structured guidance before attempting mutations.',
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
