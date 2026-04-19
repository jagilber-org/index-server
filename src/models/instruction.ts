export type AudienceScope = 'individual' | 'group' | 'all';
export type RequirementLevel = 'mandatory' | 'critical' | 'recommended' | 'optional' | 'deprecated';
export type ContentType = 'instruction' | 'template' | 'chat-session' | 'reference' | 'example' | 'agent';
export interface InstructionEntry {
  id: string;
  title: string;
  body: string;
  rationale?: string;
  priority: number; // 1 (highest) .. 100 (lowest)
  audience: AudienceScope;
  requirement: RequirementLevel;
  categories: string[];
  contentType: ContentType; // Content type classification (schema v3+)
  // Primary category (enterprise governance): canonical single category driving ownership & review.
  // Must also appear in categories[]. Added in schema v3.
  primaryCategory?: string;
  sourceHash: string; // content hash for integrity
  schemaVersion: string;
  deprecatedBy?: string;
  createdAt: string;
  updatedAt: string;
  usageCount?: number;
  firstSeenTs?: string; // timestamp when usage first observed (Phase 1 index property)
  lastUsedAt?: string;
  riskScore?: number; // derived metric
  // Structured scoping fields (optional)
  workspaceId?: string; // originating workspace / project identifier
  userId?: string;      // originating user (creator / owner) identifier
  teamIds?: string[];   // one or more team identifiers
  // Governance & lifecycle (added in 0.7.0 schema)
  version?: string;           // semantic content version of this instruction
  status?: 'draft' | 'review' | 'approved' | 'deprecated';
  owner?: string;             // responsible owner (user or team slug)
  priorityTier?: 'P1' | 'P2' | 'P3' | 'P4'; // derived from priority & requirement
  classification?: 'public' | 'internal' | 'restricted';
  lastReviewedAt?: string;    // timestamp of last manual review
  nextReviewDue?: string;     // scheduled review date
  reviewIntervalDays?: number; // persisted review interval (schema v2)
  changeLog?: { version: string; changedAt: string; summary: string }[]; // chronological changes
  supersedes?: string;        // id of instruction this one supersedes
  archivedAt?: string;        // timestamp when archived (schema v2, placeholder)
  // Content intelligence (optional)
  semanticSummary?: string;   // concise summary / first-sentence style abstract of body
  // Attribution (added in 0.8.x): who/where created the instruction
  createdByAgent?: string;     // identifier of the MCP agent / client that created this entry
  sourceWorkspace?: string;    // logical workspace/project identifier at creation time
}
