import { InstructionEntry, RequirementLevel } from '../models/instruction';
import { SCHEMA_VERSION } from '../versioning/schemaVersion';
import crypto from 'crypto';

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
    for(const cRaw of entry.categories){
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
  const semanticSummary = entry.semanticSummary || this.deriveSummary(entry.body);
  const contentType = entry.contentType || 'instruction'; // Default to 'instruction' for backward compatibility
    const norm: NormalizedInstruction = {
      ...entry,
      title: trimmedTitle,
      body: trimmedBody,
      categories: Array.from(new Set(otherCats.map(c => c.toLowerCase()))).sort(),
      updatedAt: entry.updatedAt || now,
      createdAt: entry.createdAt || now,
  // Guarantee schemaVersion presence (tests/assertions now rely on dispatcher list action output)
  schemaVersion: entry.schemaVersion || SCHEMA_VERSION,
  // Compute hash from canonical (trimmed) body to ensure stability across innocuous whitespace differences
  sourceHash: entry.sourceHash && entry.sourceHash.length === 64 ? entry.sourceHash : this.computeHash(trimmedBody),
      riskScore: this.computeRisk(entry),
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
    if(entry.requirement === 'deprecated' && !entry.deprecatedBy) issues.push('deprecated requires deprecatedBy');
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

  private computePriorityTier(priority: number, requirement: RequirementLevel): 'P1'|'P2'|'P3'|'P4' {
    // Lower numeric is higher importance
    if(priority <= 20 || requirement === 'mandatory' || requirement === 'critical') return 'P1';
    if(priority <= 40) return 'P2';
    if(priority <= 70) return 'P3';
    return 'P4';
  }

  private reviewIntervalDays(tier: 'P1'|'P2'|'P3'|'P4', requirement: RequirementLevel): number {
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
  computeReviewIntervalDays(tier: 'P1'|'P2'|'P3'|'P4', requirement: RequirementLevel): number {
    return this.reviewIntervalDays(tier, requirement);
  }

  private deriveSummary(body: string): string {
    const trimmed = body.trim();
    const firstLine = trimmed.split(/\r?\n/)[0];
    // Keep it short (~160 chars)
    return firstLine.length > 160 ? firstLine.slice(0,157)+'...' : firstLine;
  }
}
