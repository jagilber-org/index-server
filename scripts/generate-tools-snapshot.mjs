#!/usr/bin/env node
// Generate snapshot of stable tool list for contract testing
import fs from 'fs';
import path from 'path';
import { STABLE } from '../dist/services/toolRegistry.js';

const snapshotDir = path.join(process.cwd(),'snapshots');
if(!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir,{recursive:true});
const tools = Array.from(STABLE).sort();
fs.writeFileSync(path.join(snapshotDir,'stable-tools.json'), JSON.stringify({ generatedAt: new Date().toISOString(), tools }, null, 2));
console.log('stable tools snapshot written', tools.length);
