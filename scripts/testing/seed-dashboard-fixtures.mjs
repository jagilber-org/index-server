#!/usr/bin/env node
/**
 * Seed Dashboard Fixtures (JavaScript version)
 * Creates a minimal instruction and emits a sample log line so that
 * Playwright baseline tests can always capture editor + log-tail regions.
 *
 * Usage (before running Playwright):
 *   INDEX_SERVER_DASHBOARD=1 node scripts/seed-dashboard-fixtures.mjs
 *
 * Idempotent: does not overwrite existing seed instruction.
 */
import fs from 'node:fs';
import path from 'node:path';

function writeInstruction(id, body){
  const dir = path.resolve(process.cwd(), 'instructions');
  if(!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, id + '.json');
  if(!fs.existsSync(file)){
    const entry = { id, body, version: 'seed-1' };
    fs.writeFileSync(file, JSON.stringify(entry, null, 2));
    console.log('[seed] wrote instruction', file);
  } else {
    console.log('[seed] instruction already exists', id);
  }
}

function appendLog(){
  const logsDir = path.resolve(process.cwd(), 'logs');
  if(!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const file = path.join(logsDir, 'server.log');
  const line = `[seed-log] ${new Date().toISOString()} sample seeded log line for dashboard tail`;
  fs.appendFileSync(file, line + '\n');
  console.log('[seed] appended log line');
}

function main(){
  writeInstruction('dashboard-seed-instruction', 'This is a seeded instruction to ensure editor snapshot.');
  appendLog();
  console.log('[seed] complete');
}

main();
