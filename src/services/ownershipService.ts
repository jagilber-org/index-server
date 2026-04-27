import fs from 'fs';
import path from 'path';
import { logWarn } from './logger.js';
import { compileSafeRegex } from './regexSafety.js';

interface OwnershipRule { pattern: string; owner: string }
interface OwnershipConfig { ownership?: OwnershipRule[] }
interface CompiledOwnershipRule { owner: string; regex: RegExp }

let cached: { mtimeMs: number; rules: CompiledOwnershipRule[] } | null = null;

function loadRules(): CompiledOwnershipRule[] {
  const file = path.join(process.cwd(), 'owners.json');
  try {
    const stat = fs.statSync(file);
    if(cached && cached.mtimeMs === stat.mtimeMs) return cached.rules;
    const raw = JSON.parse(fs.readFileSync(file,'utf8')) as OwnershipConfig; // lgtm[js/file-system-race] — file path is cwd-resolved owners.json; mtime-checked above for cache invalidation
    const rules = Array.isArray(raw.ownership)
      ? raw.ownership.flatMap((rule): CompiledOwnershipRule[] => {
        if (!rule || typeof rule.pattern !== 'string' || typeof rule.owner !== 'string') {
          return [];
        }
        const { regex, error } = compileSafeRegex(rule.pattern);
        if (!regex) {
          logWarn(`[ownershipService] Skipping ownership rule for "${rule.owner}": ${error}`);
          return [];
        }
        return [{ owner: rule.owner, regex }];
      })
      : [];
    cached = { mtimeMs: stat.mtimeMs, rules };
    return rules;
  } catch { return []; }
}

export function resolveOwner(id: string): string | undefined {
  const rules = loadRules();
  for(const r of rules){
    if(r.regex.test(id)) return r.owner;
  }
  return undefined;
}
