/**
 * Central MCP-style tool registry.
 * Provides per-tool metadata including description, input & output JSON Schemas.
 * This enables host agents to introspect capabilities & perform client-side validation.
 */
import { schemas as outputSchemas } from '../schemas';
import { flagEnabled } from './featureFlags';

export type ToolTier = 'core' | 'extended' | 'admin';

export interface ToolRegistryEntry {
  name: string;                 // Fully qualified method name (JSON-RPC method)
  description: string;          // Human readable summary
  stable: boolean;              // Stable across sessions (deterministic side-effect free)
  mutation: boolean;            // Performs mutation / requires INDEX_SERVER_MUTATION
  tier: ToolTier;               // Visibility tier (core=always, extended=opt-in, admin=debug/ops)
  inputSchema: object;          // JSON Schema for params (always an object schema)
  outputSchema?: object;        // JSON Schema for successful result (subset of outputSchemas map)
  // Optional Zod schema (progressive enhancement). When present, runtime validation service
  // can prefer this for richer type inference while JSON Schema remains authoritative for
  // external protocol documentation / generation.
  zodSchema?: unknown;
}

// Input schema helpers (keep intentionally permissive if params optional)
const stringReq = (name: string) => ({ type: 'object', additionalProperties: false, required: [name], properties: { [name]: { type: 'string' } } });

// Explicit param schemas derived from handlers in toolHandlers.ts
const INPUT_SCHEMAS: Record<string, object> = {
  // graph export (Phase 1 + Phase 2 enrichment). All params optional.
  'graph_export': { type: 'object', additionalProperties: false, properties: {
    includeEdgeTypes: { type: 'array', items: { type: 'string', enum: ['primary','category','belongs'] }, maxItems: 3 },
    maxEdges: { type: 'number', minimum: 0 },
    // Added 'mermaid' format for dashboard visualization / documentation embedding
    format: { type: 'string', enum: ['json','dot','mermaid'] },
    enrich: { type: 'boolean' },
    includeCategoryNodes: { type: 'boolean' },
    includeUsage: { type: 'boolean' }
  } },
  'health_check': { type: 'object', additionalProperties: true }, // no params
  'index_dispatch': { type: 'object', additionalProperties: true, required: ['action'], properties: {
    action: {
      type: 'string',
      enum: [
        // Read-only queries
        'list', 'listScoped', 'get', 'getEnhanced', 'search', 'query', 'categories', 'diff', 'export',
        // Mutations
        'add', 'import', 'remove', 'reload', 'groom', 'repair', 'enrich',
        // Governance
        'governanceHash', 'governanceUpdate',
        // Utilities
        'health', 'inspect', 'dir', 'capabilities', 'batch',
        // Manifest
        'manifestStatus', 'manifestRefresh', 'manifestRepair'
      ],
      description: 'Action to perform on the instruction index. Use "capabilities" to list all supported actions.'
    },
    id: { type: 'string', description: 'Instruction ID for get, getEnhanced, remove, inspect, governanceUpdate actions.' },
    q: { type: 'string', description: 'Single-string query for search action. The dispatcher searches the full q phrase first and, if needed, retries with split-word keywords.' },
    keywords: { type: 'array', items: { type: 'string' }, description: 'Explicit keyword array for search action when the caller wants direct token control.' },
    ids: { type: 'array', items: { type: 'string' }, description: 'Array of instruction IDs for remove or export actions.' },
    category: { type: 'string', description: 'Filter by category for list action.' },
    contentType: { type: 'string', description: 'Filter by content type for list, search, or query actions.' },
    text: { type: 'string', description: 'Full-text search within query action.' },
    includeCategories: { type: 'boolean', description: 'Search categories in addition to id/title/semanticSummary/body for search action.' },
    caseSensitive: { type: 'boolean', description: 'Enable case-sensitive matching for search action.' },
    categoriesAny: { type: 'array', items: { type: 'string' }, description: 'Match instructions having any of these categories (query action).' },
    categoriesAll: { type: 'array', items: { type: 'string' }, description: 'Match instructions having all of these categories (query action).' },
    clientHash: { type: 'string', description: 'Client-side index hash for diff action (returns changes since).' },
    metaOnly: { type: 'boolean', description: 'Return metadata only (omit body) for export action.' },
    limit: { type: 'number', description: 'Maximum number of results to return (search or query action).' },
    offset: { type: 'number', description: 'Pagination offset (query action).' },
    // Mutation params for add action (flat-param support: agents can pass these at top level instead of nested entry wrapper)
    entry: { type: 'object', description: 'Instruction entry object for add action. Alternatively, pass id/body/title as top-level params.', additionalProperties: true, properties: { id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } } },
    overwrite: { type: 'boolean', description: 'Allow overwriting existing instruction (add action).' },
    lax: { type: 'boolean', description: 'Enable lax mode with default fills for missing optional fields (add action).' },
    // Import action params
    entries: { description: 'Array of instruction entries for import action, a stringified JSON array of entries, or a file path (string) to a JSON array of entries.', oneOf: [{ type: 'array', items: { type: 'object', additionalProperties: true } }, { type: 'string' }] },
    source: { type: 'string', description: 'Directory path containing .json instruction files to import (import action).' },
    mode: { description: 'Import conflict resolution mode (import action) or groom mode object (groom action).' },
    // Governance update params
    owner: { type: 'string', description: 'Owner identifier for governanceUpdate action.' },
    status: { type: 'string', description: 'Governance status for governanceUpdate action.', enum: ['approved','draft','deprecated'] },
    bump: { type: 'string', description: 'Version bump level for governanceUpdate action.', enum: ['patch','minor','major','none'] },
    lastReviewedAt: { type: 'string', description: 'Last review date (ISO 8601) for governanceUpdate action.' },
    nextReviewDue: { type: 'string', description: 'Next review due date (ISO 8601) for governanceUpdate action.' },
    // Remove action params
    missingOk: { type: 'boolean', description: 'Suppress errors for missing IDs (remove action).' },
    force: { type: 'boolean', description: 'Required for remove action when deleting more than INDEX_SERVER_MAX_BULK_DELETE items. A backup is created automatically.' },
    dryRun: { type: 'boolean', description: 'Preview what would be deleted without actually removing anything (remove action).' }
  } },
  'index_governanceHash': { type: 'object', additionalProperties: true },
  // status enum intentionally limited to schema-supported states (PROJECT_PRD Governance Hash Integrity Policy)
  'index_governanceUpdate': { type: 'object', additionalProperties: false, required: ['id'], properties: {
    id: { type: 'string' },
    owner: { type: 'string' },
    status: { type: 'string', enum: ['approved','draft','deprecated'] },
    lastReviewedAt: { type: 'string' },
    nextReviewDue: { type: 'string' },
    bump: { type: 'string', enum: ['patch','minor','major','none'] }
  } },
  // NOTE: instructions_query & instructions_categories removed as standalone tools.
  // They are now exclusively accessed via index_dispatch with actions 'query' and 'categories'.
  // legacy read-only instruction method schemas removed in favor of dispatcher
  'index_import': { type: 'object', additionalProperties: false, properties: {
    entries: { oneOf: [
      { type: 'array', minItems: 1, items: { type: 'object', required: ['id','title','body','priority','audience','requirement'], additionalProperties: true, properties: {
        id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string', maxLength: 1000000, description: 'Instruction body (default limit 20K chars, absolute max 1MB). Split oversized content into cross-linked instructions.' }, rationale: { type: 'string' }, priority: { type: 'number' }, audience: { type: 'string' }, requirement: { type: 'string' }, categories: { type: 'array', items: { type: 'string' } }, mode: { type: 'string' }
      } } },
      { type: 'string', description: 'Stringified JSON array of instruction entries, or a file path to a JSON array of instruction entries' }
    ] },
    source: { type: 'string', description: 'Directory path containing .json instruction files to import' },
    mode: { enum: ['skip','overwrite'] }
  } },
  'index_add': { type: 'object', additionalProperties: false, required: ['entry'], properties: {
    entry: { type: 'object', required: ['id','body'], additionalProperties: true, properties: {
      id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string', maxLength: 1000000, description: 'Instruction body (default limit 20K chars, absolute max 1MB). If content exceeds the limit, split into multiple cross-linked instructions with shared categories.' }, rationale: { type: 'string' }, priority: { type: 'number' }, audience: { type: 'string' }, requirement: { type: 'string' }, categories: { type: 'array', items: { type: 'string' } }, deprecatedBy: { type: 'string' }, riskScore: { type: 'number' }
    } },
    overwrite: { type: 'boolean' },
    lax: { type: 'boolean' }
  } },
  'index_repair': { type: 'object', additionalProperties: true },
  'index_reload': { type: 'object', additionalProperties: true },
  'index_remove': { type: 'object', additionalProperties: false, required: ['ids'], properties: { ids: { type: 'array', minItems: 1, items: { type: 'string' } }, missingOk: { type: 'boolean' }, force: { type: 'boolean', description: 'Required when deleting more than INDEX_SERVER_MAX_BULK_DELETE items (default 5). A backup is created first.' }, dryRun: { type: 'boolean', description: 'Preview what would be deleted without actually removing anything.' } } },
  'index_groom': { type: 'object', additionalProperties: false, properties: { mode: { type: 'object', additionalProperties: false, properties: { dryRun: { type: 'boolean' }, removeDeprecated: { type: 'boolean' }, mergeDuplicates: { type: 'boolean' }, purgeLegacyScopes: { type: 'boolean' }, remapCategories: { type: 'boolean' } } } } },
  // enrichment tool (no params required)
  'index_enrich': { type: 'object', additionalProperties: true },
  'prompt_review': stringReq('prompt'),
  'integrity_verify': { type: 'object', additionalProperties: true },
  'feature_status': { type: 'object', additionalProperties: false, properties: {} },
  'index_health': { type: 'object', additionalProperties: true },
  'usage_track': { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' }, action: { type: 'string', enum: ['retrieved', 'applied', 'cited'], description: 'Usage action type (default: retrieved)' }, signal: { type: 'string', enum: ['helpful', 'not-relevant', 'outdated', 'applied'], description: 'Qualitative signal about instruction usefulness' }, comment: { type: 'string', maxLength: 256, description: 'Optional short comment about the instruction' } } },
  'usage_hotset': { type: 'object', additionalProperties: false, properties: { limit: { type: 'number', minimum: 1, maximum: 100 } } },
  'usage_flush': { type: 'object', additionalProperties: false, properties: { id: { type: 'string', description: 'Instruction ID to reset usage for' }, before: { type: 'string', description: 'ISO date — reset usage for entries with lastUsedAt before this date' } } },
  'metrics_snapshot': { type: 'object', additionalProperties: true },
  'gates_evaluate': { type: 'object', additionalProperties: true },
  'meta_tools': { type: 'object', additionalProperties: true },
  // onboarding / help tool (no params for v1, future may allow sections[] filtering)
  'help_overview': { type: 'object', additionalProperties: true },
  // instruction schema template tool (self-documentation)
  'index_schema': { type: 'object', additionalProperties: true },
  // VSCode activation guide tools (addresses common "disabled by user" pain point)
  'meta_activation_guide': { type: 'object', additionalProperties: true },
  'meta_check_activation': { type: 'object', additionalProperties: false, properties: {
    toolName: { type: 'string', description: 'Tool name to check activation requirements for (e.g., "index_search")' }
  } },
  // manifest tools (index manifest management)
  'manifest_status': { type: 'object', additionalProperties: true },
  'manifest_refresh': { type: 'object', additionalProperties: true },
  'manifest_repair': { type: 'object', additionalProperties: true },
  // feedback system tools
  'feedback_submit': { type: 'object', additionalProperties: false, required: ['type', 'severity', 'title', 'description'], properties: {
    type: { type: 'string', enum: ['issue', 'status', 'security', 'feature-request', 'bug-report', 'performance', 'usability', 'other'] },
    severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    title: { type: 'string', maxLength: 200 },
    description: { type: 'string', maxLength: 10000 },
    context: { type: 'object', additionalProperties: true, properties: {
      clientInfo: { type: 'object', properties: { name: { type: 'string' }, version: { type: 'string' } } },
      serverVersion: { type: 'string' },
      environment: { type: 'object', additionalProperties: true },
      sessionId: { type: 'string' },
      toolName: { type: 'string' },
      requestId: { type: 'string' }
    } },
    metadata: { type: 'object', additionalProperties: true },
    tags: { type: 'array', maxItems: 10, items: { type: 'string' } }
  } },
  'feedback_list': { type: 'object', additionalProperties: false, properties: {
    type: { type: 'string', enum: ['issue', 'status', 'security', 'feature-request', 'bug-report', 'performance', 'usability', 'other'] },
    severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    status: { type: 'string', enum: ['new', 'acknowledged', 'in-progress', 'resolved', 'closed'] },
    limit: { type: 'number', minimum: 1, maximum: 200 },
    offset: { type: 'number', minimum: 0 },
    since: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } }
  } },
  'feedback_get': { type: 'object', additionalProperties: false, required: ['id'], properties: {
    id: { type: 'string' }
  } },
  'feedback_update': { type: 'object', additionalProperties: false, required: ['id'], properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['new', 'acknowledged', 'in-progress', 'resolved', 'closed'] },
    metadata: { type: 'object', additionalProperties: true }
  } },
  'feedback_stats': { type: 'object', additionalProperties: false, properties: {
    since: { type: 'string' }
  } },
  'feedback_health': { type: 'object', additionalProperties: true },
  // Unified feedback dispatch (002 Phase 2a)
  'feedback_dispatch': { type: 'object', additionalProperties: true, required: ['action'], properties: {
    action: { type: 'string', enum: ['submit', 'list', 'get', 'update', 'stats', 'health', 'rate'], description: 'Feedback action to perform.' },
    instructionId: { type: 'string', description: 'Instruction ID to rate (rate action).' },
    rating: { type: 'string', enum: ['useful', 'not-useful', 'outdated', 'incomplete'], description: 'Rating value (rate action).' },
    comment: { type: 'string', maxLength: 1000, description: 'Optional comment with rating (rate action).' },
    type: { type: 'string', enum: ['issue', 'status', 'security', 'feature-request', 'bug-report', 'performance', 'usability', 'other'] },
    severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    title: { type: 'string', maxLength: 200 },
    description: { type: 'string', maxLength: 10000, description: 'Feedback description/body text (submit).' },
    body: { type: 'string', maxLength: 10000, description: 'Alias for description (submit).' },
    id: { type: 'string' },
    status: { type: 'string', enum: ['new', 'acknowledged', 'in-progress', 'resolved', 'closed'] },
    limit: { type: 'number', minimum: 1, maximum: 200 },
    offset: { type: 'number', minimum: 0 },
    since: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    metadata: { type: 'object', additionalProperties: true }
  } },
  // instructions search tool - PRIMARY discovery mechanism
  'index_search': { type: 'object', additionalProperties: false, required: ['keywords'], properties: {
    keywords: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 100 },
      minItems: 1,
      maxItems: 10,
      description: 'Search keywords to match against instruction titles, bodies, and categories'
    },
    mode: { type: 'string', enum: ['keyword', 'regex', 'semantic'], default: 'keyword', description: 'Search mode: keyword (substring), regex (patterns like "deploy|release"), or semantic (embedding similarity). Default is semantic when INDEX_SERVER_SEMANTIC_ENABLED=1, otherwise keyword.' },
    limit: { type: 'number', minimum: 1, maximum: 100, default: 50, description: 'Maximum number of instruction IDs to return' },
    includeCategories: { type: 'boolean', default: false, description: 'Include categories in search scope' },
    caseSensitive: { type: 'boolean', default: false, description: 'Perform case-sensitive matching' },
    contentType: { type: 'string', enum: ['instruction', 'template', 'chat-session', 'reference', 'example', 'agent'], description: 'Filter results by content type (optional)' }
  } },
  // promote_from_repo tool
  'promote_from_repo': { type: 'object', additionalProperties: false, required: ['repoPath'], properties: {
    repoPath: { type: 'string', description: 'Absolute path to the Git repository root' },
    scope: { type: 'string', enum: ['all', 'governance', 'specs', 'docs', 'instructions'], default: 'all', description: 'Which content categories to promote' },
    force: { type: 'boolean', default: false, description: 'Re-promote even if content hash unchanged' },
    dryRun: { type: 'boolean', default: false, description: 'Preview what would be promoted without writing' },
    repoId: { type: 'string', description: 'Override repo identifier. Defaults to directory name.' },
  } },
  // bootstrap confirmation gating tools
  'bootstrap_request': { type: 'object', additionalProperties: false, properties: { rationale: { type: 'string' } } },
  'bootstrap_confirmFinalize': { type: 'object', additionalProperties: false, required: ['token'], properties: { token: { type: 'string' } } },
  'bootstrap_status': { type: 'object', additionalProperties: true },
  // Unified bootstrap dispatch (002 Phase 2c)
  'bootstrap': { type: 'object', additionalProperties: true, required: ['action'], properties: {
    action: { type: 'string', enum: ['request', 'confirm', 'status'], description: 'Bootstrap action to perform.' },
    rationale: { type: 'string', description: 'Rationale for bootstrap request.' },
    token: { type: 'string', description: 'Token for confirm action.' }
  } },
  // diagnostics / test-only tools (not stable)
  'diagnostics_block': { type: 'object', additionalProperties: false, required: ['ms'], properties: { ms: { type: 'number', minimum: 0, maximum: 10000 } } },
  'diagnostics_microtaskFlood': { type: 'object', additionalProperties: false, properties: { count: { type: 'number', minimum: 0, maximum: 200000 } } },
  'diagnostics_memoryPressure': { type: 'object', additionalProperties: false, properties: { mb: { type: 'number', minimum: 1, maximum: 512 } } }
};

// Inject new schema after definition block (kept outside literal to avoid large diff churn if ordering changes)
// Provide permissive object with optional includeTrace boolean.
(INPUT_SCHEMAS as Record<string, object>)['index_diagnostics'] = { type: 'object', additionalProperties: false, properties: { includeTrace: { type: 'boolean' } } };
// Normalization / hash repair tool: allows optional dryRun and forceCanonical flags.
(INPUT_SCHEMAS as Record<string, object>)['index_normalize'] = { type: 'object', additionalProperties: false, properties: { dryRun: { type: 'boolean' }, forceCanonical: { type: 'boolean' } } };
// Orphan handler schemas (handlers exist but had no INPUT_SCHEMAS entry)
(INPUT_SCHEMAS as Record<string, object>)['index_inspect'] = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } } };
(INPUT_SCHEMAS as Record<string, object>)['index_debug'] = { type: 'object', additionalProperties: true };
(INPUT_SCHEMAS as Record<string, object>)['integrity_manifest'] = { type: 'object', additionalProperties: true };

// Messaging tools: inter-agent messaging system (not stored in instruction index)
(INPUT_SCHEMAS as Record<string, object>)['messaging_send'] = { type: 'object', additionalProperties: false, required: ['channel', 'sender', 'recipients', 'body'], properties: {
  channel: { type: 'string', description: 'Target channel name' },
  sender: { type: 'string', description: 'Sender agent/instance ID' },
  recipients: { type: 'array', items: { type: 'string' }, minItems: 1, description: "Recipients list. Use ['*'] for broadcast." },
  body: { type: 'string', maxLength: 100000, description: 'Message body text' },
  ttlSeconds: { type: 'number', minimum: 1, maximum: 86400, description: 'Time-to-live in seconds (default: 3600)' },
  persistent: { type: 'boolean', description: 'If true, message survives TTL sweep' },
  payload: { type: 'object', additionalProperties: true, description: 'Structured JSON data' },
  priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
  parentId: { type: 'string', description: 'Parent message ID for threading' },
  requiresAck: { type: 'boolean', description: 'Whether acknowledgment is required' },
  ackBySeconds: { type: 'number', minimum: 1, description: 'ACK deadline in seconds from creation' },
  tags: { type: 'array', items: { type: 'string' }, description: 'Optional categorization tags' }
} };
(INPUT_SCHEMAS as Record<string, object>)['messaging_read'] = { type: 'object', additionalProperties: false, properties: {
  channel: { type: 'string', description: 'Filter by channel name' },
  reader: { type: 'string', description: 'Reader identity for visibility filtering' },
  unreadOnly: { type: 'boolean', description: 'Only return unread messages' },
  limit: { type: 'number', minimum: 1, maximum: 500, description: 'Maximum messages to return' },
  markRead: { type: 'boolean', description: 'Mark returned messages as read by reader' },
  tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags (match any)' },
  sender: { type: 'string', description: 'Filter by sender name' }
} };
(INPUT_SCHEMAS as Record<string, object>)['messaging_list_channels'] = { type: 'object', additionalProperties: true };
(INPUT_SCHEMAS as Record<string, object>)['messaging_ack'] = { type: 'object', additionalProperties: false, required: ['messageIds', 'reader'], properties: {
  messageIds: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Message IDs to acknowledge' },
  reader: { type: 'string', description: 'Reader identity' }
} };
(INPUT_SCHEMAS as Record<string, object>)['messaging_stats'] = { type: 'object', additionalProperties: false, properties: {
  reader: { type: 'string', description: 'Reader identity (default: *)' },
  channel: { type: 'string', description: 'Filter by channel' }
} };
(INPUT_SCHEMAS as Record<string, object>)['messaging_get'] = { type: 'object', additionalProperties: false, required: ['messageId'], properties: {
  messageId: { type: 'string', description: 'Message ID to retrieve' }
} };
(INPUT_SCHEMAS as Record<string, object>)['messaging_update'] = { type: 'object', additionalProperties: false, required: ['messageId'], properties: {
  messageId: { type: 'string', description: 'Message ID to update' },
  body: { type: 'string', maxLength: 100000, description: 'New message body' },
  recipients: { type: 'array', items: { type: 'string' }, description: 'New recipients list' },
  payload: { type: 'object', additionalProperties: true, description: 'New structured data' },
  persistent: { type: 'boolean', description: 'New persistence flag' }
} };
(INPUT_SCHEMAS as Record<string, object>)['messaging_purge'] = { type: 'object', additionalProperties: false, properties: {
  channel: { type: 'string', description: 'Purge messages in this channel' },
  messageIds: { type: 'array', items: { type: 'string' }, description: 'Delete specific message IDs' },
  all: { type: 'boolean', description: 'Purge all messages' }
} };
(INPUT_SCHEMAS as Record<string, object>)['messaging_reply'] = { type: 'object', additionalProperties: false, required: ['parentId', 'sender', 'body'], properties: {
  parentId: { type: 'string', description: 'ID of the message to reply to' },
  sender: { type: 'string', description: 'Sender agent/instance ID' },
  body: { type: 'string', maxLength: 100000, description: 'Reply message body' },
  replyAll: { type: 'boolean', description: 'If true, reply to all original recipients + sender (excluding self)' },
  recipients: { type: 'array', items: { type: 'string' }, description: 'Override recipients (default: reply to sender only)' },
  priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'], description: 'Priority (default: inherit from parent)' },
  tags: { type: 'array', items: { type: 'string' }, description: 'Optional categorization tags' },
  persistent: { type: 'boolean', description: 'If true, message survives TTL sweep' },
  payload: { type: 'object', additionalProperties: true, description: 'Structured JSON data' }
} };
(INPUT_SCHEMAS as Record<string, object>)['messaging_thread'] = { type: 'object', additionalProperties: false, required: ['parentId'], properties: {
  parentId: { type: 'string', description: 'Root message ID to retrieve the thread for' }
} };
(INPUT_SCHEMAS as Record<string, object>)['trace_dump'] = { type: 'object', additionalProperties: false, properties: {
  file: { type: 'string', description: 'Optional path to write the trace buffer JSON file' }
} };

// Stable & mutation classification lists (mirrors usage in toolHandlers; exported to remove duplication there).
export const STABLE = new Set(['health_check','graph_export','index_dispatch','index_search','index_governanceHash','prompt_review','integrity_verify','usage_track','usage_hotset','metrics_snapshot','gates_evaluate','meta_tools','help_overview','index_schema','feedback_list','feedback_get','feedback_stats','feedback_health','manifest_status','index_diagnostics','meta_activation_guide','meta_check_activation','feedback_dispatch','bootstrap','bootstrap_status','feature_status','index_health','index_inspect','index_debug','integrity_manifest','diagnostics_block','diagnostics_microtaskFlood','diagnostics_memoryPressure','messaging_read','messaging_list_channels','messaging_stats','messaging_get','messaging_thread','trace_dump']);
export const MUTATION = new Set(['index_add','index_import','index_repair','index_reload','index_remove','index_groom','index_enrich','index_governanceUpdate','index_normalize','usage_flush','feedback_submit','feedback_update','manifest_refresh','manifest_repair','promote_from_repo','bootstrap_request','bootstrap_confirmFinalize','messaging_send','messaging_ack','messaging_update','messaging_purge','messaging_reply']);

// Tool tier classification (002-tool-consolidation spec)
// core: always visible, essential daily use
// extended: opt-in via INDEX_SERVER_FLAG_TOOLS_EXTENDED=1 or flags.json tools_extended:true
// admin: opt-in via INDEX_SERVER_FLAG_TOOLS_ADMIN=1, rarely needed ops/debug tools
const TOOL_TIERS: Record<string, ToolTier> = {
  // Core (7)
  'health_check': 'core',
  'index_dispatch': 'core',
  'index_search': 'core',
  'prompt_review': 'core',
  'help_overview': 'core',
  'feedback_dispatch': 'core',
  'bootstrap': 'core',
  // Extended (14)
  'graph_export': 'extended',
  'usage_track': 'extended',
  'usage_hotset': 'extended',
  'index_add': 'extended',
  'index_import': 'extended',
  'index_remove': 'extended',
  'index_reload': 'extended',
  'index_governanceHash': 'extended',
  'index_governanceUpdate': 'extended',
  'gates_evaluate': 'extended',
  'integrity_verify': 'extended',
  'metrics_snapshot': 'extended',
  'promote_from_repo': 'extended',
  'index_schema': 'extended',
  // Admin (everything else)
  'feedback_submit': 'admin',
  'feedback_list': 'admin',
  'feedback_get': 'admin',
  'meta_tools': 'admin',
  'meta_activation_guide': 'admin',
  'meta_check_activation': 'admin',
  'feature_status': 'admin',
  'index_health': 'admin',
  'index_diagnostics': 'admin',
  'index_repair': 'admin',
  'index_groom': 'admin',
  'index_enrich': 'admin',
  'index_normalize': 'admin',
  'usage_flush': 'admin',
  'feedback_update': 'admin',
  'feedback_stats': 'admin',
  'feedback_health': 'admin',
  'manifest_status': 'admin',
  'manifest_refresh': 'admin',
  'manifest_repair': 'admin',
  'bootstrap_request': 'admin',
  'bootstrap_confirmFinalize': 'admin',
  'bootstrap_status': 'admin',
  'diagnostics_block': 'admin',
  'diagnostics_microtaskFlood': 'admin',
  'diagnostics_memoryPressure': 'admin',
  'index_inspect': 'admin',
  'index_debug': 'admin',
  'integrity_manifest': 'admin',
  // Messaging tools (extended tier)
  'messaging_send': 'extended',
  'messaging_read': 'extended',
  'messaging_list_channels': 'extended',
  'messaging_ack': 'extended',
  'messaging_stats': 'extended',
  'messaging_get': 'extended',
  'messaging_update': 'extended',
  'messaging_purge': 'extended',
  'messaging_reply': 'extended',
  'messaging_thread': 'extended',
  'trace_dump': 'admin',
};

// Tier ordering for filter comparison
const TIER_LEVEL: Record<ToolTier, number> = { core: 0, extended: 1, admin: 2 };

export interface ToolRegistryFilter {
  tier?: ToolTier;
}

/** Resolve the maximum visible tier from feature flags. */
export function resolveActiveTier(): ToolTier {
  if (flagEnabled('tools_admin')) return 'admin';
  if (flagEnabled('tools_extended')) return 'extended';
  return 'core';
}

export function getToolRegistry(filter?: ToolRegistryFilter): ToolRegistryEntry[] {
  const maxTier = filter?.tier ?? resolveActiveTier();
  const maxLevel = TIER_LEVEL[maxTier];
  const entries: ToolRegistryEntry[] = [];
  const names = new Set<string>([...STABLE, ...MUTATION]);
  // Ensure we also expose any tools that have schemas even if not in STABLE/MUTATION lists.
  for(const k of Object.keys(INPUT_SCHEMAS)) names.add(k);
  for(const name of Array.from(names).sort()){
    const tier = TOOL_TIERS[name] || 'admin';
    if (TIER_LEVEL[tier] > maxLevel) continue;
    const outputSchema = (outputSchemas as Record<string, object>)[name];
    entries.push({
      name,
      description: describeTool(name),
      stable: STABLE.has(name),
      mutation: MUTATION.has(name),
      tier,
      inputSchema: INPUT_SCHEMAS[name] || { type: 'object' },
      outputSchema,
      // zodSchema to be attached incrementally by a forthcoming zodRegistry enhancer.
    });
  }
  return entries;
}

function describeTool(name: string): string {
  switch(name){
    case 'health_check': return 'Returns server health status & version.';
  case 'graph_export': return 'Export instruction relationship graph (schema v1 minimal or v2 enriched).';
  case 'index_dispatch': return 'Unified dispatcher for instruction index operations. Required: "action". Key params by action: get/getEnhanced(id), search(q or keywords, includeCategories, caseSensitive, limit, mode), query(text,categoriesAny,limit,offset), list(category), diff(clientHash), export(ids,metaOnly), remove(id or ids). Use action="capabilities" to discover all supported actions.';
  case 'index_search': return '🔍 PRIMARY: Search instructions by keywords — returns instruction IDs for targeted retrieval. Supports mode: "keyword" (substring match), "regex" (patterns like "deploy|release"), or "semantic" (embedding similarity). Default mode is semantic when INDEX_SERVER_SEMANTIC_ENABLED=1, otherwise keyword. Use this FIRST to discover relevant instructions, then use index_dispatch get for details.';
  case 'index_governanceHash': return 'Return governance projection & deterministic governance hash.';
  // query & categories now accessed via dispatcher actions.
  // legacy read-only instruction descriptions removed (handled via dispatcher)
    case 'index_import': return 'Import instruction entries from: inline array (entries), stringified JSON array, file path to JSON array (entries as string), or directory of .json files (source).';
  case 'index_add': return 'Add a single instruction (lax mode fills defaults; overwrite optional).';
    case 'index_repair': return 'Repair out-of-sync sourceHash fields (noop if none drifted).';
  case 'index_reload': return 'Force reload of instruction index from disk.';
  case 'index_remove': return 'Delete one or more instruction entries by id. Bulk deletes exceeding INDEX_SERVER_MAX_BULK_DELETE (default 5) require force=true and auto-create a backup first. Use dryRun=true to preview.';
  case 'index_groom': return 'Groom index: normalize, repair hashes, merge duplicates, remove deprecated, remap categories, apply usage signal feedback (outdated/not-relevant/helpful/applied) to instruction priority and requirement.';
  case 'index_enrich': return 'Persist normalization of placeholder governance fields to disk.';
  case 'index_governanceUpdate': return 'Patch limited governance fields (owner/status/review dates + optional version bump).';
    case 'prompt_review': return 'Static analysis of a prompt returning issues & summary.';
  case 'integrity_verify': return 'Verify each instruction body hash against stored sourceHash.';
  case 'feature_status': return 'Report active index feature flags and counters.';
    case 'usage_track': return 'Track instruction usage with optional qualitative signal. Params: id (required), action (retrieved|applied|cited), signal (helpful|not-relevant|outdated|applied), comment (short text, max 256 chars).';
    case 'usage_hotset': return 'Return the most-used instruction entries (hot set).';
    case 'usage_flush': return 'Reset usage counters for a specific instruction (by id) or for entries with lastUsedAt before a given date.';
    case 'metrics_snapshot': return 'Performance metrics summary for handled methods.';
  case 'index_health': return 'Compare live index to canonical snapshot for drift.';
    case 'gates_evaluate': return 'Evaluate configured gating criteria over current index.';
    case 'meta_tools': return 'Enumerate available tools & their metadata.';
  // feedback system descriptions
  case 'feedback_submit': return 'Submit feedback entry (issue, status report, security alert, feature request, etc.).';
  case 'feedback_list': return 'List feedback entries with filtering options (type, severity, status, date range).';
  case 'feedback_get': return 'Get specific feedback entry by ID with full details.';
  case 'feedback_update': return 'Update feedback entry status and metadata (admin function).';
  case 'feedback_stats': return 'Get feedback system statistics and metrics dashboard.';
  case 'feedback_health': return 'Health check for feedback system storage and configuration.';
  case 'feedback_dispatch': return 'Unified feedback dispatcher. Actions: submit, list, get, update, stats, health, rate.';
  case 'bootstrap': return 'Unified bootstrap dispatcher. Actions: request, confirm, status.';
  case 'manifest_status': return 'Report index manifest presence and drift summary.';
  case 'manifest_refresh': return 'Rewrite manifest from current index state.';
  case 'manifest_repair': return 'Repair manifest by reconciling drift with index.';
  case 'promote_from_repo': return 'Scan a local Git repository and promote its knowledge content (constitutions, docs, instructions, specs) into the instruction index. Reads .specify/config/promotion-map.json and instructions/*.json from the target repo.';
  case 'bootstrap_request': return 'Request a human confirmation bootstrap token (hash persisted, raw returned once).';
  case 'bootstrap_confirmFinalize': return 'Finalize bootstrap by submitting issued token; enables guarded mutations.';
  case 'bootstrap_status': return 'Return bootstrap gating status (referenceMode, confirmed, requireConfirmation).';
  // diagnostics descriptions
  case 'diagnostics_block': return 'Intentionally CPU blocks the event loop for N ms (diagnostic stress).';
  case 'diagnostics_microtaskFlood': return 'Flood the microtask queue with many Promise resolutions to probe event loop starvation.';
  case 'diagnostics_memoryPressure': return 'Allocate & release transient memory to induce GC / memory pressure.';
  case 'diagnostics_handshake': return 'Return recent handshake events (ordering/ready/list_changed trace).';
  case 'help_overview': return 'Structured onboarding guidance for new agents (tool discovery, index lifecycle, promotion workflow).';
  case 'index_schema': return 'Return instruction JSON schema, examples, validation rules, and promotion workflow guidance for self-documentation.';
  case 'index_diagnostics': return 'Summarize loader diagnostics: scanned vs accepted, skipped reasons, missing IDs, optional trace sample.';
  case 'index_normalize': return 'Normalize instruction JSON files (hash repair, version hydrate, timestamps) with optional dryRun.';
  case 'meta_activation_guide': return 'Comprehensive guide for activating Index Server tools in VSCode. Explains why settings.json alone is insufficient and provides activation function reference for all tool categories.';
  case 'meta_check_activation': return 'Check activation requirements for a specific tool. Returns the VSCode activation function needed and step-by-step instructions.';
  case 'index_inspect': return 'Return raw instruction entry by ID for debugging (full JSON).';
  case 'index_debug': return 'Dump raw index state for debugging (entry count, keys, load status).';
  case 'integrity_manifest': return 'Verify integrity of index manifest entries against stored sourceHash values.';
  // messaging system descriptions
  case 'messaging_send': return 'Send a message to a channel with recipient targeting. Supports broadcast (*), directed, priority, TTL, threading, and structured payloads.';
  case 'messaging_read': return 'Read messages from a channel with visibility filtering. Supports unread-only, limit, mark-as-read, tag filtering, and sender filtering.';
  case 'messaging_list_channels': return 'List all active messaging channels with message counts and latest timestamps.';
  case 'messaging_ack': return 'Acknowledge (mark as read) one or more messages by ID.';
  case 'messaging_stats': return 'Get messaging statistics for a reader: total, unread, channel count.';
  case 'messaging_get': return 'Get a single message by ID with full details.';
  case 'messaging_update': return 'Update mutable fields of a message (body, recipients, payload, persistent flag).';
  case 'messaging_purge': return 'Delete messages: all, by channel, or by specific IDs.';
  case 'messaging_reply': return 'Reply to a message with auto-populated channel and parentId. Supports reply-all (all original recipients) or reply-to-sender.';
  case 'messaging_thread': return 'Retrieve a full message thread by root parentId. Returns parent + all nested replies sorted chronologically.';
  case 'trace_dump': return 'Write the in-memory trace ring buffer to a file and return a summary (records count, bytes, env). Requires tracing to be enabled.';
    default: return 'Tool description pending.';
  }
}

// Registry version bumped to align with dispatcher consolidation docs regeneration (TOOLS-GENERATED.md)
export const REGISTRY_VERSION = '2026-03-29';
