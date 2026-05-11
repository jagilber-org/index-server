import { z } from 'zod';
import { getToolRegistry, ToolRegistryEntry } from './toolRegistry';
import { getRuntimeConfig } from '../config/runtimeConfig';
import {
  INPUT_KEYS,
  REQUIRED_INPUT_KEYS,
  SERVER_MANAGED_KEYS,
} from '../schemas/instructionSchema';
import { CONTENT_TYPES } from '../models/instruction';

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
  contentType: z.enum(CONTENT_TYPES).optional(),
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
function zInstructionBody() {
  return z.string().min(1).max(getRuntimeConfig().index.bodyWarnLength);
}

/**
 * Per-field Zod refinements for the canonical INPUT_KEYS surface.
 *
 * The canonical schema (schemas/instruction.schema.json) is the single
 * source of truth for which fields callers may submit on `index_add` /
 * `index_import`. The Ajv `validateInput` validator (compiled from that
 * canonical schema) is the authoritative type/format/length gate and runs
 * inside the handler.
 *
 * This Zod schema sits in front of the handler in the default validation
 * mode (transport.validateParams). Its job is therefore narrow:
 *
 *  1. Accept EVERY canonical input field — never reject a field the
 *     canonical INPUT_SCHEMA accepts.
 *  2. Reject truly unknown top-level entry keys (`.strict()`).
 *  3. Provide light, fast checks (string length on body, enum on
 *     audience/etc.) so obvious garbage fails before the handler runs.
 *
 * Anything missing from this map is still accepted (as `unknown`) — the
 * canonical Ajv validator will reject malformed payloads with the precise
 * JSON-Schema error.
 */
function buildEntryShape(): z.ZodRawShape {
  const refinements: Partial<Record<string, z.ZodTypeAny>> = {
    id: z.string().min(1),
    title: z.string().min(1),
    body: zInstructionBody(),
    rationale: z.string(),
    priority: z.number().int().min(1).max(100),
    audience: z.string(),
    requirement: z.string(),
    categories: z.array(z.string()).max(50),
    deprecatedBy: z.string(),
    riskScore: z.number(),
    version: z.string(),
    owner: z.string(),
    status: z.enum(['approved', 'draft', 'review', 'deprecated']),
    priorityTier: z.enum(['P1', 'P2', 'P3', 'P4']),
    classification: z.enum(['public', 'internal', 'restricted']),
    lastReviewedAt: z.string(),
    nextReviewDue: z.string(),
    semanticSummary: z.string(),
    changeLog: z.array(z.object({}).passthrough()),
    contentType: z.enum(CONTENT_TYPES),
    extensions: z.record(z.string(), zExtensionValue),
  };
  const shape: z.ZodRawShape = {};
  for (const key of INPUT_KEYS) {
    // Server-managed keys must never appear in the input shape.
    if (SERVER_MANAGED_KEYS.has(key)) continue;
    const refined = refinements[key] ?? z.unknown();
    shape[key] = REQUIRED_INPUT_KEYS.has(key) ? refined : refined.optional();
  }
  return shape;
}

function buildZAdd() {
  // index_add allows the handler to default required fields (e.g. priority,
  // audience), so the entry contract here mirrors the canonical surface but
  // does NOT enforce REQUIRED_INPUT_KEYS at the Zod layer. The handler /
  // canonical Ajv `validateInput` apply the per-tool required[] minimum.
  const entry = z.object(
    Object.fromEntries(
      Object.entries(buildEntryShape()).map(([k, v]) => {
        const t = v as z.ZodTypeAny;
        return [k, t.isOptional() ? t : t.optional()];
      }),
    ) as z.ZodRawShape,
  ).strict();
  return z.object({
    entry,
    overwrite: z.boolean().optional(),
    lax: z.boolean().optional()
  }).strict();
}

function buildZImport() {
  const entryItem = z.object(buildEntryShape()).strict();
  return z.object({
    entries: z.union([
      z.array(entryItem).min(1),
      z.string()
    ]).optional(),
    source: z.string().optional(),
    mode: z.enum(['skip','overwrite']).optional()
  }).strict();
}

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
  contentType: z.enum(CONTENT_TYPES).optional()
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

const zFeedbackManage = z.object({
  action: z.enum(['submit', 'list', 'get', 'update', 'delete', 'stats']),
  id: z.string().min(1).optional(),
  type: z.enum(['issue', 'status', 'security', 'feature-request', 'bug-report', 'performance', 'usability', 'other']).optional(),
  severity: z.enum(['low','medium','high','critical']).optional(),
  status: z.enum(['new', 'acknowledged', 'in-progress', 'resolved', 'closed']).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(10000).optional(),
  context: z.object({}).passthrough().optional(),
  metadata: z.object({}).passthrough().optional(),
  tags: z.array(z.string()).max(10).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
  since: z.string().optional()
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
  'feedback_manage': zFeedbackManage,
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

function getZodSchemaForTool(toolName: string): z.ZodTypeAny | undefined {
  if (toolName === 'index_add') return buildZAdd();
  if (toolName === 'index_import') return buildZImport();
  return zodMap[toolName];
}

export function getZodEnhancedRegistry(): ToolRegistryEntry[] {
  const base = getToolRegistry({ tier: 'admin' });
  for(const e of base){
    const zSchema = getZodSchemaForTool(e.name);
    if(zSchema){
      e.zodSchema = zSchema;
    }
  }
  return base;
}

/** Get the Zod schema for a specific tool by name */
export function getZodSchema(toolName: string): z.ZodTypeAny | undefined {
  return getZodSchemaForTool(toolName);
}

/** Check if a tool has a Zod schema registered */
export function hasZodSchema(toolName: string): boolean {
  return toolName === 'index_add' || toolName === 'index_import' || toolName in zodMap;
}

export type ExtractParams<T extends string> = T extends keyof typeof zodMap ? z.infer<(typeof zodMap)[T]> : unknown;
