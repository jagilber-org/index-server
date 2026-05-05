#!/usr/bin/env ts-node
/**
 * Seed Dashboard Fixtures
 * Creates a minimal instruction and emits a sample log line so that
 * Playwright baseline tests can always capture editor + log-tail regions.
 *
 * Usage (before running Playwright):
 *   INDEX_SERVER_DASHBOARD=1 node dist/scripts/seed-dashboard-fixtures.js
 * (or ts-node directly in dev) when server is running.
 */
import fs from 'node:fs';
import path from 'node:path';

interface InstructionEntry { id: string; body: string; version?: string; }

function writeInstruction(id: string, body: string){
  const dir = path.resolve(process.cwd(), 'instructions');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, id + '.json');
  try {
    const entry: InstructionEntry = { id, body, version: 'seed-1' };
    fs.writeFileSync(file, JSON.stringify(entry, null, 2), { flag: 'wx' });
    console.log('[seed] wrote instruction', file);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
      console.log('[seed] instruction already exists', id);
    } else { throw e; }
  }
}

function appendLog(){
  const logsDir = path.resolve(process.cwd(), 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
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
