import fs from 'fs';
import path from 'path';
import { logWarn, logInfo } from './logger.js';
import { compileSafeRegex } from './regexSafety.js';

export interface PromptRule {
  id: string; pattern?: string; mustContain?: string; severity: string; description: string;
}
export interface PromptCategory { id: string; rules: PromptRule[] }
export interface PromptCriteria { version: string; categories: PromptCategory[] }
export interface PromptIssue { ruleId: string; severity: string; description: string; match?: string }
interface CompiledPromptRule extends PromptRule { patternRegex?: RegExp; mustContainRegex?: RegExp }
interface CompiledPromptCategory { id: string; rules: CompiledPromptRule[] }

export class PromptReviewService {
  private compiledCategories: CompiledPromptCategory[];
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
      // Write to stderr explicitly (logWarn writes to stderr)
      logWarn(msg);
      loaded = { version: '0.0.0', categories: [] };
    } else {
      logInfo(`[promptReviewService] Loaded criteria from ${usedPath}`); // stderr so it won't pollute stdout
    }
    this.compiledCategories = this.compileCategories(loaded);
  }
  /**
   * Run all loaded criteria rules against a prompt string and return any detected issues.
   * @param prompt - Prompt text to review
   * @returns Array of {@link PromptIssue} objects describing detected rule violations; empty when clean
   */
  review(prompt: string): PromptIssue[] {
    const issues: PromptIssue[] = [];
    for(const cat of this.compiledCategories){
      for(const rule of cat.rules){
        if(rule.patternRegex){
          rule.patternRegex.lastIndex = 0;
          const m = prompt.match(rule.patternRegex);
          if(m){
            issues.push({ ruleId: rule.id, severity: rule.severity, description: rule.description, match: m[0] });
          }
        }
        if(rule.mustContainRegex){
          if(!rule.mustContainRegex.test(prompt)){
            issues.push({ ruleId: rule.id, severity: rule.severity, description: 'Missing required token(s): ' + rule.description });
          }
        }
      }
    }
    return issues;
  }

  private compileCategories(criteria: PromptCriteria): CompiledPromptCategory[] {
    return criteria.categories.map((category) => ({
      id: category.id,
      rules: category.rules.map((rule) => this.compileRule(category.id, rule)),
    }));
  }

  private compileRule(categoryId: string, rule: PromptRule): CompiledPromptRule {
    const compiled: CompiledPromptRule = { ...rule };
    if (rule.pattern) {
      const { regex, error } = compileSafeRegex(rule.pattern, 'gi');
      if (regex) {
        compiled.patternRegex = regex;
      } else {
        logWarn(`[promptReviewService] Skipping unsafe pattern regex for rule "${rule.id}" in category "${categoryId}": ${error}`);
      }
    }
    if (rule.mustContain) {
      const { regex, error } = compileSafeRegex(rule.mustContain, 'i');
      if (regex) {
        compiled.mustContainRegex = regex;
      } else {
        logWarn(`[promptReviewService] Skipping unsafe mustContain regex for rule "${rule.id}" in category "${categoryId}": ${error}`);
      }
    }
    return compiled;
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
