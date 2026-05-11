#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startMcp } from '../transport/mcp-stdio.mjs';
const env = parseEnvFile(resolve(process.argv[2]));
const dist = resolve('dist/server/index-server.js');
const mcp = await startMcp({ env, distServer: dist, cwd: process.cwd() });
try {
  const list = await mcp.callTool('index_dispatch', { action: 'list', limit: 10 });
  console.log('---LIST---'); console.log(JSON.stringify(list, null, 2));
  const exp = await mcp.callTool('index_dispatch', { action: 'export' });
  console.log('---EXPORT---'); console.log(JSON.stringify(exp, null, 2));
  // try import shape
  const sample = { id: 'shape-probe-x1', title: 't', body: 'b', priority: 50, audience: 'all', requirement: 'optional', categories: ['x'], contentType: 'instruction' };
  const imp = await mcp.callTool('index_import', { entries: [sample], mode: 'overwrite' });
  console.log('---IMPORT---'); console.log(JSON.stringify(imp, null, 2));
  const after = await mcp.callTool('index_dispatch', { action: 'list', limit: 10 });
  console.log('---LIST AFTER---'); console.log(JSON.stringify(after, null, 2));
  await mcp.callTool('index_remove', { ids: ['shape-probe-x1'] });
} finally { await mcp.close(); }
function parseEnvFile(file){const t=readFileSync(file,'utf8');const e={};for(const l of t.split(/\r?\n/)){const s=l.trim();if(!s||s.startsWith('#'))continue;const i=s.indexOf('=');if(i<0)continue;e[s.slice(0,i).trim()]=s.slice(i+1).trim();}return e;}
