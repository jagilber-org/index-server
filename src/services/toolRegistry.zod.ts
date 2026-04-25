import { z } from 'zod';
import { getToolRegistry, ToolRegistryEntry } from './toolRegistry';

/**
 * Complete Zod schema registry for all MCP index tools.
 * Zod schemas provide runtime validation with richer type inference.
 * JSON Schemas in the base registry remain the external protocol contract.
 */

// ── Reusable primitives ──────────────────────────────────────────────────────
const zEmpty = z.object({}).passthrough();
const zStringId = z.object({ id: z.string().min(1) }).strict();
const zExtensionValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(zExtensionValue),
    z.record(z.string(), zExtensionValue),
  ]),
);
// ── Index dispatcher ───────────────────────────────────────────────────────
const zDispatch = z.object({
  action: z.enum([
    'list', 'listScoped', 'get', 'getEnhanced', 'search', 'query', 'categories', 'diff', 'export',
    'add', 'import', 'remove', 'reload', 'groom', 'repair', 'enrich',
    'governanceHash', 'governanceUpdate',
    'health', 'inspect', 'dir', 'capabilities', 'batch',
    'manifestStatus', 'manifestRefresh', 'manifestRepair'
  ]),
  id: z.string().optional(),
  q: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  ids: z.array(z.string()).optional(),
  category: z.string().optional(),
  contentType: z.enum(['instruction', 'template', 'chat-session', 'reference', 'example', 'agent']).optional(),
  text: z.string().optional(),
  includeCategories: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  categoriesAny: z.array(z.string()).optional(),
  categoriesAll: z.array(z.string()).optional(),
  clientHash: z.string().optional(),
  metaOnly: z.boolean().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  entry: z.object({}).passthrough().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  rationale: z.string().optional(),
  priority: z.number().optional(),
  audience: z.string().optional(),
  requirement: z.string().optional(),
  categories: z.array(z.string()).optional(),
  deprecatedBy: z.string().optional(),
  riskScore: z.number().optional(),
  priorityTier: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  classification: z.enum(['public', 'internal', 'restricted']).optional(),
  semanticSummary: z.string().optional(),
  changeLog: z.array(z.object({}).passthrough()).optional(),
  overwrite: z.boolean().optional(),
  lax: z.boolean().optional(),
  entries: z.union([z.array(z.object({}).passthrough()), z.string()]).optional(),
  source: z.string().optional(),
  mode: z.unknown().optional(),
  owner: z.string().optional(),
  status: z.enum(['approved', 'draft', 'review', 'deprecated']).optional(),
  bump: z.enum(['patch','minor','major','none']).optional(),
  lastReviewedAt: z.string().optional(),
  nextReviewDue: z.string().optional(),
  missingOk: z.boolean().optional(),
  force: z.boolean().optional(),
  dryRun: z.boolean().optional()
}).passthrough();

// ── Index CRUD ─────────────────────────────────────────────────────────────
const zIndexEntry = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  body: z.string().min(1).max(1000000),
  rationale: z.string().optional(),
  priority: z.number().int().min(1).max(100).optional(),
  audience: z.string().optional(),
  requirement: z.string().optional(),
  categories: z.array(z.string()).max(50).optional(),
  deprecatedBy: z.string().optional(),
  riskScore: z.number().optional(),
  version: z.string().optional(),
  owner: z.string().optional(),
  status: z.enum(['approved', 'draft', 'review', 'deprecated']).optional(),
  priorityTier: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  classification: z.enum(['public', 'internal', 'restricted']).optional(),
  lastReviewedAt: z.string().optional(),
  nextReviewDue: z.string().optional(),
  semanticSummary: z.string().optional(),
  changeLog: z.array(z.object({}).passthrough()).optional(),
  contentType: z.enum(['instruction', 'template', 'chat-session', 'reference', 'example', 'agent']).optional(),
  extensions: z.record(z.string(), zExtensionValue).optional()
}).strict();

const zAdd = z.object({
  entry: zIndexEntry,
  overwrite: z.boolean().optional(),
  lax: z.boolean().optional()
}).strict();

const zImport = z.object({
  entries: z.union([
    z.array(z.object({
      id: z.string(),
      title: z.string(),
      body: z.string().max(1000000),
      rationale: z.string().optional(),
      priority: z.number(),
      audience: z.string(),
      requirement: z.string(),
      categories: z.array(z.string()).optional(),
      extensions: z.record(z.string(), zExtensionValue).optional(),
      mode: z.string().optional()
    }).passthrough()).min(1),
    z.string()
  ]).optional(),
  source: z.string().optional(),
  mode: z.enum(['skip','overwrite']).optional()
}).strict();

const zRemove = z.object({
  ids: z.array(z.string()).min(1),
  missingOk: z.boolean().optional(),
  force: z.boolean().optional(),
  dryRun: z.boolean().optional()
}).strict();

const zGroom = z.object({
  mode: z.object({
    dryRun: z.boolean().optional(),
    removeDeprecated: z.boolean().optional(),
    mergeDuplicates: z.boolean().optional(),
    purgeLegacyScopes: z.boolean().optional(),
    remapCategories: z.boolean().optional()
  }).strict().optional()
}).strict();

const zNormalize = z.object({
  dryRun: z.boolean().optional(),
  forceCanonical: z.boolean().optional()
}).strict();

const zInspect = zStringId;

// ── Governance ───────────────────────────────────────────────────────────────
const zGovernanceUpdate = z.object({
  id: z.string().min(1),
  owner: z.string().min(1).optional(),
  status: z.enum(['approved','draft','deprecated']).optional(),
  lastReviewedAt: z.string().optional(),
  nextReviewDue: z.string().optional(),
  bump: z.enum(['patch','minor','major','none']).optional()
}).strict();

// ── Search ───────────────────────────────────────────────────────────────────
const zSearch = z.object({
  keywords: z.array(z.string().min(1).max(100)).min(1).max(10),
  mode: z.enum(['keyword', 'regex', 'semantic']).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  includeCategories: z.boolean().default(false).optional(),
  caseSensitive: z.boolean().default(false).optional(),
  contentType: z.enum(['instruction', 'template', 'chat-session', 'reference', 'example', 'agent']).optional()
}).strict();

// ── Diagnostics ──────────────────────────────────────────────────────────────
const zDiagnostics = z.object({
  includeTrace: z.boolean().optional()
}).strict();

// ── Feedback ─────────────────────────────────────────────────────────────────
const zFeedbackSubmit = z.object({
  type: z.enum(['issue', 'status', 'security', 'feature-request', 'bug-report', 'performance', 'usability', 'other']),
  severity: z.enum(['low','medium','high','critical']),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10000),
  context: z.object({}).passthrough().optional(),
  metadata: z.object({}).passthrough().optional(),
  tags: z.array(z.string()).max(10).optional()
}).strict();

// ── Usage ────────────────────────────────────────────────────────────────────
const zUsageTrack = z.object({
  id: z.string().min(1),
  action: z.enum(['retrieved', 'applied', 'cited']).optional(),
  signal: z.enum(['helpful', 'not-relevant', 'outdated', 'applied']).optional(),
  comment: z.string().max(256).optional()
}).strict();

const zHotset = z.object({
  limit: z.number().int().min(1).max(100).optional()
}).strict();

const zUsageFlush = z.object({
  id: z.string().optional(),
  before: z.string().optional()
}).strict();

// ── Graph ────────────────────────────────────────────────────────────────────
const zGraphExport = z.object({
  includeEdgeTypes: z.array(z.enum(['primary','category','belongs'])).max(3).optional(),
  maxEdges: z.number().int().min(0).optional(),
  format: z.enum(['json','dot','mermaid']).optional(),
  enrich: z.boolean().optional(),
  includeCategoryNodes: z.boolean().optional(),
  includeUsage: z.boolean().optional()
}).strict();

// ── Prompt review ────────────────────────────────────────────────────────────
const zPromptReview = z.object({
  prompt: z.string().min(1)
}).strict();

// ── Promote from repo ────────────────────────────────────────────────────────
const zPromoteFromRepo = z.object({
  repoPath: z.string().min(1),
  scope: z.enum(['all', 'governance', 'specs', 'docs', 'instructions']).default('all').optional(),
  force: z.boolean().default(false).optional(),
  dryRun: z.boolean().default(false).optional(),
  repoId: z.string().optional()
}).strict();

// ── Bootstrap ────────────────────────────────────────────────────────────────
const zBootstrapRequest = z.object({
  rationale: z.string().optional()
}).strict();

const zBootstrapConfirm = z.object({
  token: z.string().min(1)
}).strict();

const zBootstrap = z.object({
  action: z.enum(['request', 'confirm', 'status']),
  rationale: z.string().optional(),
  token: z.string().optional()
}).passthrough();

// ── Integrity ────────────────────────────────────────────────────────────────
const zGatesEvaluate = zEmpty;
const zIntegrityVerify = zEmpty;
const zIntegrityManifest = zEmpty;

// ── Meta / Activation ────────────────────────────────────────────────────────
const zMetaCheckActivation = z.object({
  toolName: z.string().optional()
}).strict();

// ── Diagnostics stress tools ─────────────────────────────────────────────────
const zDiagnosticsBlock = z.object({
  ms: z.number().min(0).max(10000)
}).strict();

const zDiagnosticsMicrotaskFlood = z.object({
  count: z.number().min(0).max(200000).optional()
}).strict();

const zDiagnosticsMemoryPressure = z.object({
  mb: z.number().min(1).max(512).optional()
}).strict();

// ── Manifest ─────────────────────────────────────────────────────────────────
const zManifestStatus = zEmpty;
const zManifestRefresh = zEmpty;
const zManifestRepair = zEmpty;

// ═══════════════════════════════════════════════════════════════════════════════
// Complete tool -> Zod schema mapping for all registered tools
// ═══════════════════════════════════════════════════════════════════════════════
const zodMap: Record<string, z.ZodTypeAny> = {
  // Core tools
  'health_check': zEmpty,
  'index_dispatch': zDispatch,
  'index_search': zSearch,
  'prompt_review': zPromptReview,
  'help_overview': zEmpty,
  'bootstrap': zBootstrap,

  // Extended tools
  'graph_export': zGraphExport,
  'usage_track': zUsageTrack,
  'usage_hotset': zHotset,
  'index_add': zAdd,
  'index_import': zImport,
  'index_remove': zRemove,
  'index_reload': zEmpty,
  'index_governanceHash': zEmpty,
  'index_governanceUpdate': zGovernanceUpdate,
  'gates_evaluate': zGatesEvaluate,
  'integrity_verify': zIntegrityVerify,
  'metrics_snapshot': zEmpty,
  'promote_from_repo': zPromoteFromRepo,
  'index_schema': zEmpty,

  // Admin tools
  'feedback_submit': zFeedbackSubmit,
  'meta_tools': zEmpty,
  'meta_activation_guide': zEmpty,
  'meta_check_activation': zMetaCheckActivation,
  'feature_status': zEmpty,
  'index_health': zEmpty,
  'index_diagnostics': zDiagnostics,
  'index_repair': zEmpty,
  'index_groom': zGroom,
  'index_enrich': zEmpty,
  'index_normalize': zNormalize,
  'usage_flush': zUsageFlush,
  'manifest_status': zManifestStatus,
  'manifest_refresh': zManifestRefresh,
  'manifest_repair': zManifestRepair,
  'bootstrap_request': zBootstrapRequest,
  'bootstrap_confirmFinalize': zBootstrapConfirm,
  'bootstrap_status': zEmpty,
  'index_inspect': zInspect,
  'index_debug': zEmpty,
  'integrity_manifest': zIntegrityManifest,
  'diagnostics_block': zDiagnosticsBlock,
  'diagnostics_microtaskFlood': zDiagnosticsMicrotaskFlood,
  'diagnostics_memoryPressure': zDiagnosticsMemoryPressure,
};

export function getZodEnhancedRegistry(): ToolRegistryEntry[] {
  const base = getToolRegistry({ tier: 'admin' });
  for(const e of base){
    const zSchema = zodMap[e.name];
    if(zSchema){
      e.zodSchema = zSchema;
    }
  }
  return base;
}

/** Get the Zod schema for a specific tool by name */
export function getZodSchema(toolName: string): z.ZodTypeAny | undefined {
  return zodMap[toolName];
}

/** Check if a tool has a Zod schema registered */
export function hasZodSchema(toolName: string): boolean {
  return toolName in zodMap;
}

export type ExtractParams<T extends string> = T extends keyof typeof zodMap ? z.infer<(typeof zodMap)[T]> : unknown;
