#!/usr/bin/env node
// Simple coverage alias script (no TypeScript typing required)
/* eslint-disable */
const fs = require('fs');
const path = require('path');
const coverageDir = path.join(process.cwd(),'coverage');
if(!fs.existsSync(coverageDir)) process.exit(0);
const files = fs.readdirSync(coverageDir).filter(f=> /cobertura/i.test(f) && f.endsWith('.xml'));
if(!files.length) process.exit(0);
const source = path.join(coverageDir, files[0]);
const target = path.join(coverageDir,'coverage.xml');
try { fs.copyFileSync(source, target); console.log(`[coverage-alias] Copied ${files[0]} -> coverage.xml`); }
catch(e){ console.error('[coverage-alias] Failed to copy:', e.message); process.exit(1); }
