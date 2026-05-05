#!/usr/bin/env node
import { rmSync, readdirSync } from 'fs';
import { join } from 'path';
const dir = join(process.cwd(),'src','types');
const keep = new Set(['sdk-shim.d.ts']);
for(const f of readdirSync(dir)){
  if(f.endsWith('.d.ts') && !keep.has(f)){
    try { rmSync(join(dir,f)); console.log('[purge-extra-decls] removed', f); } catch(e){ console.error('[purge-extra-decls] failed', f, e); }
  }
}
