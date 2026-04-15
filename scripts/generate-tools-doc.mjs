#!/usr/bin/env node
/**
 * Generates docs/TOOLS-GENERATED.md from the compiled registry (dist output).
 * Run after build: npm run build && npm run docs:tools
 */
import fs from 'fs';
import path from 'path';

const distRegistry = path.join(process.cwd(), 'dist', 'services', 'toolRegistry.js');
if(!fs.existsSync(distRegistry)){
  console.error('Build output not found. Run `npm run build` first.');
  process.exit(1);
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getToolRegistry, REGISTRY_VERSION } = await import('file://' + distRegistry);
const entries = getToolRegistry();

const lines = [];
lines.push('# Generated Tool Registry');
lines.push('');
lines.push(`Registry Version: ${REGISTRY_VERSION}`);
lines.push('');
lines.push('| Method | Stable | Mutation | Description |');
lines.push('|--------|--------|----------|-------------|');
for(const e of entries){
  lines.push(`| ${e.name} | ${e.stable ? 'yes' : ''} | ${e.mutation ? 'yes' : ''} | ${e.description.replace(/\|/g,'\\|')} |`);
}
lines.push('');
lines.push('## Schemas');
for(const e of entries){
  lines.push(`### ${e.name}`);
  lines.push('**Input Schema**');
  lines.push('```json');
  lines.push(JSON.stringify(e.inputSchema, null, 2));
  lines.push('```');
  if(e.outputSchema){
    lines.push('**Output Schema (Result)**');
    lines.push('```json');
    lines.push(JSON.stringify(e.outputSchema, null, 2));
    lines.push('```');
  }
  lines.push('');
}

const outPath = path.join(process.cwd(), 'docs', 'TOOLS-GENERATED.md');
fs.writeFileSync(outPath, lines.join('\n'));
console.error('Wrote', outPath);
