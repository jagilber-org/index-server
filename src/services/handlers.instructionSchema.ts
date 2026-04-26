/**
 * Instruction Schema Handler
 *
 * Provides self-documentation tool 'index_schema' that returns:
 * - Full JSON schema for instruction entries
 * - Minimal example template
 * - Validation rules and constraints
 * - Field descriptions and requirements
 *
 * Addresses Priority 2.1: Self-documentation of instruction schema format
 * Source: Production feedback entry 1967100008b4b465 (2026-01-25)
 */
import { registerHandler } from '../server/registry';
import * as fs from 'fs';
import * as path from 'path';
import { getRuntimeConfig } from '../config/runtimeConfig';

const SCHEMA_VERSION = '1.0.0';

interface InstructionSchemaResponse {
  generatedAt: string;
  version: string;
  summary: string;
  schema: unknown;
  minimalExample: unknown;
  requiredFields: string[];
  optionalFieldsCommon: string[];
  promotionWorkflow: {
    stage: string;
    description: string;
    checklistItems: string[];
  }[];
  validationRules: {
    field: string;
    rule: string;
    constraint: string;
  }[];
  nextSteps: string[];
}

/**
 * Load the canonical instruction.schema.json from disk
 */
function loadInstructionSchema(): unknown {
  const schemaPath = path.join(__dirname, '../../schemas/instruction.schema.json');
  return JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
}

/**
 * Build a minimal valid instruction entry template
 */
function buildMinimalExample(): unknown {
  return {
    id: "example-instruction-id",
    title: "Example Instruction Title",
    body: "Detailed instruction content goes here. This is the primary guidance text that agents will follow.\n\nYou can use markdown formatting for clarity.",
    priority: 50,
    audience: "all",
    requirement: "recommended",
    categories: ["example", "documentation"],
    primaryCategory: "example",
    contentType: "instruction",
    schemaVersion: "4"
  };
}

/**
 * Build a comprehensive example with governance metadata
 */
function _buildComprehensiveExample(): unknown {
  return {
    id: "comprehensive-example-id",
    title: "Comprehensive Example with Governance",
    body: "This example shows all recommended fields for a complete instruction.\n\n## Purpose\nDescribe the purpose and context.\n\n## Usage\nProvide specific usage guidance.\n\n## Examples\nInclude concrete examples.",
    rationale: "Optional rationale explaining why this instruction exists and what problem it solves.",
    priority: 30,
    audience: "all",
    requirement: "recommended",
    categories: ["example", "documentation", "governance"],
    primaryCategory: "governance",
    contentType: "instruction",
    schemaVersion: "4",
    version: "1.0.0",
    status: "approved",
    owner: "platform-team",
    priorityTier: "P2",
    classification: "internal",
    reviewIntervalDays: 90,
    semanticSummary: "Example instruction demonstrating comprehensive governance metadata and best practices.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastReviewedAt: new Date().toISOString(),
    nextReviewDue: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
  };
}

/**
 * Define promotion workflow stages
 */
function definePromotionWorkflow() {
  return [
    {
      stage: 'P0: Local Development',
      description: 'Workspace-specific experimental instruction, not indexed',
      checklistItems: [
        'Create instruction file in local workspace directory',
        'Include required fields: id, title, body, priority, audience, requirement, categories',
        'Test locally with index_dispatch {action: "query", id: "your-id"}',
        'Iterate rapidly without governance overhead'
      ]
    },
    {
      stage: 'P1: Pre-Promotion Review',
      description: 'Quality checks before indexing',
      checklistItems: [
        'Ensure uniqueness: no duplicate id or near-duplicate body',
        'Add semantic summary (semanticSummary field)',
        'Assign owner and classification',
        'Set priorityTier (P1/P2/P3/P4)',
        'Run prompt_review for large bodies to check quality',
        'Run integrity_verify to confirm no drift',
        'Establish review cadence (lastReviewedAt, nextReviewDue, reviewIntervalDays)'
      ]
    },
    {
      stage: 'P1: Indexed Baseline',
      description: 'Canonical, versioned, governance-compliant instruction',
      checklistItems: [
        'Submit via index_dispatch {action: "add", ...}',
        'Verify instruction appears in index_dispatch {action: "list"}',
        'Monitor index_health for recursionRisk=none',
        'Track usage with usage_track',
        'Maintain via index_dispatch {action: "update"} as needed'
      ]
    },
    {
      stage: 'P2+: Optional Refinement',
      description: 'Broader distribution and enhanced governance',
      checklistItems: [
        'Accumulate usage metrics over multiple sessions',
        'Demonstrate cross-category or cross-team relevance',
        'Bump priorityTier if warranted',
        'Initialize changeLog for version tracking',
        'Consider promotion to higher tier (P2, P3, etc.)'
      ]
    }
  ];
}

/**
 * Define key validation rules
 */
function defineValidationRules() {
  const bodyWarnLength = getRuntimeConfig().index.bodyWarnLength.toLocaleString('en-US');
  return [
    { field: 'id', rule: 'Pattern', constraint: '^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$ (120 chars max, lowercase, no leading/trailing hyphen/underscore)' },
    { field: 'id', rule: 'Uniqueness', constraint: 'Must be unique across the index' },
    { field: 'title', rule: 'Length', constraint: '1-200 characters, non-empty' },
    { field: 'body', rule: 'Length', constraint: `1-${bodyWarnLength} characters on add/import writes (INDEX_SERVER_BODY_WARN_LENGTH), markdown supported` },
    { field: 'priority', rule: 'Range', constraint: '1-100 (lower number = higher priority)' },
    { field: 'audience', rule: 'Enum', constraint: 'One of: individual, group, all' },
    { field: 'requirement', rule: 'Enum', constraint: 'One of: mandatory, critical, recommended, optional, deprecated' },
    { field: 'categories', rule: 'Array', constraint: '0-25 items, each 1-49 chars, lowercase, pattern: ^[a-z0-9][a-z0-9-_]{0,48}$' },
    { field: 'primaryCategory', rule: 'Reference', constraint: 'Must be a member of categories array if present' },
    { field: 'contentType', rule: 'Enum', constraint: 'One of: instruction (default), template, chat-session, reference, example, agent' },
    { field: 'schemaVersion', rule: 'Enum', constraint: 'Currently "4"' },
    { field: 'sourceHash', rule: 'Pattern', constraint: 'SHA256 hex string (64 chars) when present' },
    { field: 'version', rule: 'Pattern', constraint: 'Semantic version: ^\\d+\\.\\d+\\.\\d+$ (e.g., "1.0.0")' },
    { field: 'status', rule: 'Enum', constraint: 'One of: draft, review, approved, deprecated' },
    { field: 'priorityTier', rule: 'Enum', constraint: 'One of: P1, P2, P3, P4' },
    { field: 'classification', rule: 'Enum', constraint: 'One of: public, internal, restricted' },
    { field: 'reviewIntervalDays', rule: 'Range', constraint: '1-365 days' }
  ];
}

registerHandler('index_schema', () => {
  const schema = loadInstructionSchema();

  const response: InstructionSchemaResponse = {
    generatedAt: new Date().toISOString(),
    version: SCHEMA_VERSION,
    summary: 'Instruction schema template with validation rules, examples, and promotion workflow guidance.',
    schema,
    minimalExample: buildMinimalExample(),
    requiredFields: [
      'id',
      'title',
      'body',
      'priority',
      'audience',
      'requirement',
      'categories'
    ],
    optionalFieldsCommon: [
      'rationale',
      'primaryCategory',
      'contentType',
      'schemaVersion',
      'version',
      'status',
      'owner',
      'priorityTier',
      'classification',
      'semanticSummary',
      'reviewIntervalDays',
      'lastReviewedAt',
      'nextReviewDue'
    ],
    promotionWorkflow: definePromotionWorkflow(),
    validationRules: defineValidationRules(),
    nextSteps: [
      '1. Review the minimalExample for required fields',
      '2. Study promotionWorkflow stages (P0 → P1 → P2+)',
      '3. Validate against validationRules before submission',
      '4. Use index_dispatch {action: "add"} to create (writes are enabled by default; set INDEX_SERVER_MUTATION=0 for read-only mode)',
      '5. Monitor index_health for recursionRisk and drift',
      '6. Track usage with usage_track',
      '7. Iterate via index_dispatch {action: "update"} as needed',
      '8. Consult help_overview for broader lifecycle guidance'
    ]
  };

  return response;
});
