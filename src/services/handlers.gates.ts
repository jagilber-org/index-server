import fs from 'fs';
import path from 'path';
import { registerHandler } from '../server/registry';
import { ensureLoaded, getInstructionsDir } from './indexContext';

interface GateCount { id:string; type:'count'; op:string; value:number; severity:string; description?:string; where?: { requirement?: string; priorityGt?: number } }

registerHandler('gates_evaluate', ()=>{ const st=ensureLoaded(); const gatesPath=path.join(getInstructionsDir(),'gates.json'); if(!fs.existsSync(gatesPath)) return { notConfigured:true }; let data: { gates:GateCount[] }; try { data=JSON.parse(fs.readFileSync(gatesPath,'utf8')); } catch { return { error:'invalid gates file' }; } const results: { id:string; passed:boolean; count:number; op:string; value:number; severity:string; description?:string }[]=[]; for(const g of data.gates||[]){ if(g.type!=='count') continue; const matches=st.list.filter(e=>{ const w=g.where||{}; let ok=true; if(w.requirement!==undefined) ok=ok && e.requirement===w.requirement; if(w.priorityGt!==undefined) ok=ok && e.priority> w.priorityGt; return ok; }); const count=matches.length; const v=g.value; let passed=true; switch(g.op){ case '>=': passed=count>=v; break; case '>': passed=count>v; break; case '<=': passed=count<=v; break; case '<': passed=count<v; break; case '==': passed=count===v; break; case '!=': passed=count!==v; break; } results.push({ id:g.id, passed, count, op:g.op, value:v, severity:g.severity, description:g.description }); } const summary={ errors: results.filter(r=> !r.passed && r.severity==='error').length, warnings: results.filter(r=> !r.passed && r.severity==='warn').length, total: results.length }; return { generatedAt:new Date().toISOString(), results, summary }; });

export {};
