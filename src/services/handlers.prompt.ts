import { registerHandler } from '../server/registry';
import { PromptReviewService, summarizeIssues } from './promptReviewService';

const promptService = new PromptReviewService();
registerHandler('prompt_review', (p:{prompt:string})=>{ const raw=p.prompt||''; const MAX=10_000; if(raw.length>MAX) return { truncated:true, message:'prompt too large', max:MAX }; const sanitized=raw.replace(/\0/g,''); const issues=promptService.review(sanitized); const summary=summarizeIssues(issues); return { issues, summary, length: sanitized.length }; });

export {};
