#!/usr/bin/env node
/**
 * flake-baseline-generate.mjs
 * Derives a candidate flake-baseline.json from historical telemetry.
 *
 * Inputs:
 *  FLAKE_HISTORY_FILE (default: test-results/flake-history.jsonl)
 *  MIN_OCCURRENCES (default: 2) - minimum flaky occurrences to include
 *  WINDOW_LIMIT (optional) - only consider most recent N entries in history
 *  OUTPUT (default: flake-baseline.generated.json) - candidate file path (does NOT overwrite existing baseline)
 *
 * History Format (each line JSON): {
 *   timestamp, runId, flakyFiles:[{file, occurrences}], totalFlakyOccurrences, distinctFlakyFiles
 * }
 */
import fs from 'fs';
import path from 'path';

const historyPath = process.env.FLAKE_HISTORY_FILE || path.join('test-results','flake-history.jsonl');
const minOccurrences = Number(process.env.MIN_OCCURRENCES || '2');
const windowLimit = process.env.WINDOW_LIMIT ? Number(process.env.WINDOW_LIMIT) : undefined;
const outPath = process.env.OUTPUT || 'flake-baseline.generated.json';

if(!fs.existsSync(historyPath)){
  console.error('[baseline-generate] No history file at', historyPath);
  process.exit(1);
}

const lines = fs.readFileSync(historyPath,'utf8').split(/\r?\n/).filter(Boolean);
const slice = windowLimit ? lines.slice(-windowLimit) : lines;
const aggregate = new Map(); // file -> { occurrences, firstSeen, lastSeen }

for(const line of slice){
  try {
    const obj = JSON.parse(line);
    if(Array.isArray(obj.flakyFiles)){
      for(const f of obj.flakyFiles){
        if(!f || !f.file) continue;
        const cur = aggregate.get(f.file) || { occurrences:0, firstSeen: obj.timestamp, lastSeen: obj.timestamp };
        cur.occurrences += (f.occurrences || 1);
        if(obj.timestamp < cur.firstSeen) cur.firstSeen = obj.timestamp;
        if(obj.timestamp > cur.lastSeen) cur.lastSeen = obj.timestamp;
        aggregate.set(f.file, cur);
      }
    }
  } catch {/* ignore malformed */}
}

const candidates = [...aggregate.entries()]
  .filter(([,v])=> v.occurrences >= minOccurrences)
  .sort((a,b)=> b[1].occurrences - a[1].occurrences)
  .map(([file,v])=> ({ file, since: v.firstSeen, lastSeen: v.lastSeen, occurrences: v.occurrences }));

const output = {
  _comment: 'Generated candidate baseline – review and merge manually into flake-baseline.json (do not commit this file directly without pruning).',
  version: 1,
  generatedAt: new Date().toISOString(),
  files: candidates
};

fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`[baseline-generate] Wrote ${candidates.length} candidate entries to ${outPath}`);
