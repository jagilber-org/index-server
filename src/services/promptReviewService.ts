import fs from 'fs';
import path from 'path';

export interface PromptRule {
  id: string; pattern?: string; mustContain?: string; severity: string; description: string;
}
export interface PromptCategory { id: string; rules: PromptRule[] }
export interface PromptCriteria { version: string; categories: PromptCategory[] }
export interface PromptIssue { ruleId: string; severity: string; description: string; match?: string }

export class PromptReviewService {
  private criteria: PromptCriteria;
  /**
   * @param criteriaPath - Optional explicit path to a `PROMPT-CRITERIA.json` file.
   *   When omitted the service searches a set of standard candidate locations.
   */
  constructor(criteriaPath?: string){
    // Resolve criteria path with fallbacks so the server doesn't crash if cwd differs.
    const candidates: string[] = [];
    if(criteriaPath){
      candidates.push(criteriaPath);
    } else {
      // Original expected (project root when launched correctly)
      candidates.push(path.join(process.cwd(),'docs','PROMPT-CRITERIA.json'));
      // From compiled file location: dist/services -> ../../docs
      candidates.push(path.resolve(__dirname,'..','..','docs','PROMPT-CRITERIA.json'));
      // Additional fallback: dist/server -> ../docs
      candidates.push(path.resolve(__dirname,'..','docs','PROMPT-CRITERIA.json'));
    }
    let loaded: PromptCriteria | undefined;
    let usedPath: string | undefined;
    for(const p of candidates){
      try {
        const data = fs.readFileSync(p,'utf8');
        loaded = JSON.parse(data) as PromptCriteria;
        usedPath = p;
        break;
      } catch { /* continue */ }
    }
    if(!loaded){
      // Graceful fallback: empty criteria so server can still start.
      const msg = `[promptReviewService] WARN: Could not locate PROMPT-CRITERIA.json in any candidate paths. Using empty criteria.`;
      // Write to stderr explicitly (console.error already does)
      console.error(msg);
      loaded = { version: '0.0.0', categories: [] };
    } else {
      console.error(`[promptReviewService] Loaded criteria from ${usedPath}`); // stderr so it won't pollute stdout
    }
    this.criteria = loaded;
  }
  /**
   * Run all loaded criteria rules against a prompt string and return any detected issues.
   * @param prompt - Prompt text to review
   * @returns Array of {@link PromptIssue} objects describing detected rule violations; empty when clean
   */
  review(prompt: string): PromptIssue[] {
    const issues: PromptIssue[] = [];
    for(const cat of this.criteria.categories){
      for(const rule of cat.rules){
        if(rule.pattern){
          // Apply global + case-insensitive flags for broader detection
          const regex = new RegExp(rule.pattern,'gi');
            const m = prompt.match(regex);
            if(m){
              issues.push({ ruleId: rule.id, severity: rule.severity, description: rule.description, match: m[0] });
            }
        }
        if(rule.mustContain){
          const mc = new RegExp(rule.mustContain,'i');
          if(!mc.test(prompt)){
            issues.push({ ruleId: rule.id, severity: rule.severity, description: 'Missing required token(s): ' + rule.description });
          }
        }
      }
    }
    return issues;
  }
}

/**
 * Aggregate a list of prompt issues into per-severity counts and identify the highest severity present.
 * @param issues - Array of issues returned by {@link PromptReviewService.review}
 * @returns Object with `counts` map (severity → count) and `highestSeverity` string
 */
export function summarizeIssues(issues: PromptIssue[]): { counts: Record<string, number>; highestSeverity: string } {
  const counts: Record<string, number> = {};
  const severityRank: Record<string, number> = { critical:4, high:3, medium:2, low:1, info:0 };
  let max = -1; let highest = 'info';
  for(const i of issues){
    counts[i.severity] = (counts[i.severity]||0)+1;
    const r = severityRank[i.severity] ?? 0;
    if(r>max){ max = r; highest = i.severity; }
  }
  return { counts, highestSeverity: highest };
}
