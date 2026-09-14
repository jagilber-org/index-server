import { InstructionEntry, RequirementLevel, PriorityTier } from '../models/instruction';
import { SCHEMA_VERSION } from '../versioning/schemaVersion';
import crypto from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- extends InstructionEntry with potential future fields
export interface NormalizedInstruction extends InstructionEntry {}

export class ClassificationService {
  /**
   * Normalize an instruction entry by filling governance defaults, deriving scope fields,
   * computing hashes, and canonicalizing text fields.
   * @param entry - Raw instruction entry to normalize
   * @returns A fully normalized {@link NormalizedInstruction} with all governance defaults applied
   */
  normalize(entry: InstructionEntry): NormalizedInstruction {
    const now = new Date().toISOString();
  const trimmedTitle = entry.title.trim();
  const trimmedBody = entry.body.trim();
    // Derive structured scope fields from legacy category prefixes if not already present
    let workspaceId = entry.workspaceId;
    let userId = entry.userId;
  const teamIds = entry.teamIds ? [...entry.teamIds] : [];
    const otherCats: string[] = [];
    for(const cRaw of entry.categories ?? []){
      const c = cRaw.toLowerCase();
      if(c.startsWith('scope:workspace:')){ if(!workspaceId) workspaceId = c.substring('scope:workspace:'.length); continue; }
      if(c.startsWith('scope:user:')){ if(!userId) userId = c.substring('scope:user:'.length); continue; }
      if(c.startsWith('scope:team:')){ const tid = c.substring('scope:team:'.length); if(tid && !teamIds.includes(tid)) teamIds.push(tid); continue; }
      otherCats.push(cRaw);
    }
    // Governance defaults
  const version = entry.version || '1.0.0';
  const status = entry.status || (entry.requirement === 'deprecated' ? 'deprecated' : 'approved');
  const owner = entry.owner || 'unowned';
  const priorityTier = entry.priorityTier || this.computePriorityTier(entry.priority, entry.requirement);
  const classification = entry.classification || 'internal';
  const lastReviewedAt = entry.lastReviewedAt || now;
  const reviewIntervalDays = entry.reviewIntervalDays ?? this.reviewIntervalDays(priorityTier, entry.requirement);
  const nextReviewDue = entry.nextReviewDue || new Date(Date.now() + reviewIntervalDays*86400_000).toISOString();
  const changeLog = entry.changeLog && entry.changeLog.length ? entry.changeLog : [{ version, changedAt: entry.createdAt || now, summary: 'initial import' }];
  const rawSummary = entry.semanticSummary;
  const normalizeForComparison = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const isDegenerateHeading = rawSummary && /^\s*#{1,6}\s/.test(rawSummary);
  const isTitleDuplicate = rawSummary && trimmedTitle &&
    normalizeForComparison(rawSummary) === normalizeForComparison(trimmedTitle);
  const semanticSummary = (rawSummary && !isDegenerateHeading && !isTitleDuplicate)
    ? rawSummary
    : this.deriveSummary(entry.body, trimmedTitle);
  const contentType = entry.contentType || 'instruction'; // Default to 'instruction' for backward compatibility
    const norm: NormalizedInstruction = {
      ...entry,
      title: trimmedTitle,
      body: trimmedBody,
      categories: Array.from(new Set(otherCats.map(c => c.toLowerCase()))).sort(),
      updatedAt: entry.updatedAt || now,
      createdAt: entry.createdAt || now,
  // Always coerce to current SCHEMA_VERSION on normalization. The write path
  // (writeEntry / writeEntryAsync) validates against the loader JSON schema
  // which only accepts the current version. Preserving a legacy version here
  // would cause silent write rejection. Migration of legacy fields runs
  // separately via migrateInstructionRecord on the write path.
  schemaVersion: SCHEMA_VERSION,
  // Compute hash from canonical (trimmed) body to ensure stability across innocuous whitespace differences
  sourceHash: entry.sourceHash && entry.sourceHash.length === 64 ? entry.sourceHash : this.computeHash(trimmedBody),
      // Honor caller-supplied riskScore when provided (#350). Only fall back to
      // the derived risk when the entry has no explicit value. The schema and
      // tool registry both advertise riskScore as caller-settable, so silently
      // overwriting was a docs/behavior contract violation.
      riskScore: entry.riskScore !== undefined ? entry.riskScore : this.computeRisk(entry),
      workspaceId,
      userId,
      teamIds: teamIds.length ? teamIds : undefined,
      version,
      status,
      owner,
      priorityTier,
      classification,
      lastReviewedAt,
      nextReviewDue,
      reviewIntervalDays,
      changeLog: changeLog,
      supersedes: entry.supersedes,
      semanticSummary,
      contentType
    };
    return norm;
  }

  /**
   * Validate an instruction entry for required fields and logical consistency.
   * @param entry - Instruction entry to validate
   * @returns Array of human-readable issue strings; empty when the entry is valid
   */
  validate(entry: InstructionEntry): string[] {
    const issues: string[] = [];
    if(!entry.id) issues.push('missing id');
    if(!entry.title) issues.push('missing title');
    if(!entry.body) issues.push('missing body');
    return issues;
  }

  /**
   * Compute a numeric risk score for an instruction entry (higher = riskier).
   * Score is derived from priority and requirement level.
   * @param entry - Instruction entry to score
   * @returns Numeric risk score
   */
  computeRisk(entry: InstructionEntry): number {
    const base = 100 - Math.min(Math.max(entry.priority,1),100);
    const reqWeight = this.requirementWeight(entry.requirement);
    return base + reqWeight;
  }

  private requirementWeight(r: RequirementLevel): number {
    switch(r){
      case 'mandatory': return 50;
      case 'critical': return 60;
      case 'recommended': return 20;
      case 'optional': return 5;
      case 'deprecated': return -30;
      default: return 0;
    }
  }

  /**
   * Compute a SHA-256 hex digest of the given content string.
   * @param content - UTF-8 string to hash
   * @returns 64-character hex-encoded SHA-256 digest
   */
  computeHash(content: string): string { return crypto.createHash('sha256').update(content,'utf8').digest('hex'); }

  private computePriorityTier(priority: number, requirement: RequirementLevel): PriorityTier {
    // Lower numeric is higher importance
    if(priority <= 20 || requirement === 'mandatory' || requirement === 'critical') return 'P1';
    if(priority <= 40) return 'P2';
    if(priority <= 70) return 'P3';
    return 'P4';
  }

  private reviewIntervalDays(tier: PriorityTier, requirement: RequirementLevel): number {
    // Shorter intervals for higher criticality
    if(tier === 'P1' || requirement === 'mandatory' || requirement === 'critical') return 30;
    if(tier === 'P2') return 60;
    if(tier === 'P3') return 90;
    return 120;
  }

  // Public helper for schema migration - computes review interval
  /**
   * Compute the recommended review interval in days for a given priority tier and requirement level.
   * @param tier - Priority tier (`'P1'`–`'P4'`; P1 is highest priority)
   * @param requirement - Requirement level for the instruction
   * @returns Number of days until the next review should occur
   */
  computeReviewIntervalDays(tier: PriorityTier, requirement: RequirementLevel): number {
    return this.reviewIntervalDays(tier, requirement);
  }

  private deriveSummary(body: string, title?: string): string {
    const trimmed = body.trim();
    const lines = trimmed.split(/\r?\n/);
    const normalizeText = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const normalizedTitle = title ? normalizeText(title) : '';

    let fallbackHeading = '';
    for (const line of lines) {
      const stripped = line.trim();
      if (!stripped) continue;
      // Check if line is a markdown heading
      const headingMatch = stripped.match(/^#{1,6}\s+(.*)/);
      if (headingMatch) {
        if (!fallbackHeading) fallbackHeading = headingMatch[1].trim();
        continue;
      }
      // Skip lines that restate the title
      if (normalizedTitle && normalizeText(stripped) === normalizedTitle) continue;
      // First real prose line
      return stripped.length > 160 ? stripped.slice(0, 157) + '...' : stripped;
    }
    // No prose found - fall back to first heading with markers stripped
    if (fallbackHeading) {
      return fallbackHeading.length > 160 ? fallbackHeading.slice(0, 157) + '...' : fallbackHeading;
    }
    // Absolute fallback: first line trimmed
    const firstLine = lines[0]?.trim() || '';
    return firstLine.length > 160 ? firstLine.slice(0, 157) + '...' : firstLine;
  }
}
