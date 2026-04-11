import fs from 'fs';
import path from 'path';

interface OwnershipRule { pattern: string; owner: string }
interface OwnershipConfig { ownership?: OwnershipRule[] }

let cached: { mtimeMs: number; rules: OwnershipRule[] } | null = null;

function loadRules(): OwnershipRule[] {
  const file = path.join(process.cwd(), 'owners.json');
  try {
    if(!fs.existsSync(file)) return [];
    const stat = fs.statSync(file);
    if(cached && cached.mtimeMs === stat.mtimeMs) return cached.rules;
    const raw = JSON.parse(fs.readFileSync(file,'utf8')) as OwnershipConfig;
    const rules = Array.isArray(raw.ownership) ? raw.ownership.filter(r => r && typeof r.pattern === 'string' && typeof r.owner === 'string') : [];
    cached = { mtimeMs: stat.mtimeMs, rules };
    return rules;
  } catch { return []; }
}

export function resolveOwner(id: string): string | undefined {
  const rules = loadRules();
  for(const r of rules){
    try { const re = new RegExp(r.pattern); if(re.test(id)) return r.owner; } catch { /* ignore */ }
  }
  return undefined;
}
