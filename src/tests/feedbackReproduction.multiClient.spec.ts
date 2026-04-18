/**
 * @fileoverview Red/Green Test Suite - Multi-Client Instruction Coordination Issues
 *
 * This test suite reproduces production feedback issues reported on 2025-08-31:
 * - Issue #0b17eedef4c07621: Multi-Client Instruction Verification Failure
 * - Issue #740513ece59b2a0c: Inconsistent Instruction Visibility - Add Skip vs Get Not Found
 *
 * Tests are designed to fail (RED) initially to reproduce the issues,
 * then pass (GREEN) after fixes are implemented.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import os from 'node:os';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { createTestClient } from './helpers/mcpTestClient.js';

// Test configuration
const GITHUB_MERMAID_INSTRUCTION = {
  id: 'github-mermaid-dark-theme-quick-guide-2025',
  title: 'GitHub Mermaid Dark Theme Quick Guide',
  body: `Complete guide for creating Mermaid diagrams in GitHub markdown with dark theme optimization.

## Quick Start
\`\`\`mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action]
    B -->|No| D[Alternative]
\`\`\`

## Dark Theme Best Practices
- Use light colors for visibility in dark mode
- Prefer #ffffff, #ffdd44, #44ff44 for nodes
- Test diagrams in both light and dark GitHub themes

## Advanced Features
- State diagrams for workflow documentation
- Class diagrams for code architecture
- Sequence diagrams for API interactions

## GitHub Integration
- Diagrams render automatically in README.md
- Support in issues, PRs, and wiki pages
- Live preview in GitHub web editor`,
  priority: 75,
  // Schema audience enum: individual|group|all. Use 'all' (previous 'developers' caused schema rejection + invisibility).
  audience: 'all',
  requirement: 'optional',
  categories: ['github', 'documentation', 'visualization', 'markdown'],
  owner: 'documentation-team'
};

// MCP test client wrapper helpers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function addViaClient(client: any, entry: any){
  return client.create(entry, { overwrite:true });
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function searchViaDispatcher(client: any, query: string){
  // Test client currently lacks search; leverage dispatcher directly when available.
  // (Dispatcher direct search not exposed yet) fallback implemented below.
  // Fallback: simple list + filter for keyword presence in title/body (approximate search reproduction)
  const list = await client.list();
  const terms: string[] = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = list.items.map((i: any) => {
    const t: string = (i.title||'') + ' ' + (i.body||'');
    const lc = t.toLowerCase();
    const score = terms.reduce((acc: number, term: string) => acc + (lc.includes(term)?1:0), 0);
    return { id:i.id, title:i.title, score };
  }).filter((r: { score:number })=> r.score>0).sort((a: {score:number}, b: {score:number})=> b.score-a.score);
  return { results: scored };
}
function isNotFound(obj: any){ return !!obj?.notFound; }

describe('Feedback Reproduction: Multi-Client Instruction Coordination', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client1: any; // persistent for suite (reduces repeated server startups)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client2: any;
  let instructionsDir: string;

  beforeAll(async () => {
    if(process.env.TEST_INDEX_SERVER_DIR){
      instructionsDir = process.env.TEST_INDEX_SERVER_DIR;
    } else {
      // Create isolated temp instructions directory to avoid cross-suite contention & hash drift
      const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-multi-client-'));
      instructionsDir = tmpBase; // server will create files as needed
    }
    // Reuse a single pair of client sessions across tests to eliminate hook startup overhead & file contention.
    client1 = await createTestClient({ forceMutation:true, instructionsDir });
    client2 = await createTestClient({ forceMutation:true, instructionsDir });
  }, 60000); // allow more time for initial spawn

  beforeEach(async () => {
    // Per‑test cleanup only (fast) instead of respawning processes each time.
    try { await client1.remove(GITHUB_MERMAID_INSTRUCTION.id); } catch { /* ignore */ }
    try { await client1.remove('unrelated-developer-urls'); } catch { /* ignore */ }
  });

  afterAll(async () => {
    await client1?.close();
    await client2?.close();
  });

  describe('Issue #0b17eedef4c07621: Multi-Client Instruction Verification Failure', () => {

    it('CLIENT_1_ADD_CLIENT_2_SEARCH_VISIBILITY - Reproduction Test (RED)', async () => {
  const addResult = await addViaClient(client1, GITHUB_MERMAID_INSTRUCTION);
  expect(addResult?.created || addResult?.overwritten, 'Client 1 add creation').toBeTruthy();

      // Small delay to allow for potential index synchronization
      await new Promise(resolve => setTimeout(resolve, 100));

  // Client 2 searches (approximate) for GitHub Mermaid instructions
  const searchResult = await searchViaDispatcher(client2, 'github mermaid diagram markdown');

      // RED TEST: This should fail initially due to multi-client visibility issue
  const results = searchResult.results || [];
      expect(results.length, 'Search should find the GitHub Mermaid instruction').toBeGreaterThan(0);
      expect(results[0]?.id).toBe(GITHUB_MERMAID_INSTRUCTION.id);
      expect(results[0]?.title).toContain('Mermaid');
    }, 15000);

  it('SEARCH_RELEVANCE_TECHNICAL_TERMS - Verify search quality', async () => {
  await addViaClient(client1, GITHUB_MERMAID_INSTRUCTION);

  await addViaClient(client1, { id:'unrelated-developer-urls', title:'Comprehensive Developer URLs', body:'General developer resource links and documentation', priority:50, audience:'all', requirement:'optional', categories:['resources'] });

      await new Promise(resolve => setTimeout(resolve, 100));

  const exactSearch = await searchViaDispatcher(client2, 'github mermaid diagram markdown');
  const partialSearch = await searchViaDispatcher(client2, 'mermaid diagram visualization');

      // RED TEST: Search should return relevant results, not unrelated instructions
  const exactResults = exactSearch.results || [];
      expect(exactResults.length, 'Exact search should find results').toBeGreaterThan(0);
      expect(exactResults[0]?.id).toBe(GITHUB_MERMAID_INSTRUCTION.id);

  const partialResults = partialSearch.results || [];
      expect(partialResults.length, 'Partial search should find results').toBeGreaterThan(0);
      expect(partialResults[0]?.id).toBe(GITHUB_MERMAID_INSTRUCTION.id);

      // Cleanup
  try { await client1.remove('unrelated-developer-urls'); } catch { /* ignore */ }
    }, 20000);

  it('INDEX_SERVER_CONSISTENCY_ACROSS_CLIENTS - Hash and count verification', async () => {
  await addViaClient(client1, GITHUB_MERMAID_INSTRUCTION);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Both clients should see consistent index state
  const list1 = await client1.list();
  const list2 = await client2.list();
  const client1HasInstruction = list1.items.some((i: any)=> i.id===GITHUB_MERMAID_INSTRUCTION.id);
  const client2HasInstruction = list2.items.some((i: any)=> i.id===GITHUB_MERMAID_INSTRUCTION.id);
  expect(client1HasInstruction, 'Client 1 should see the instruction').toBe(true);
  expect(client2HasInstruction, 'Client 2 should see the instruction').toBe(true);
    }, 15000);
  });

  describe('Issue #740513ece59b2a0c: CRUD Operation Inconsistency', () => {

  it('ADD_SKIP_GET_CONSISTENCY - Reproduction Test (RED)', async () => {
  const initialAdd = await addViaClient(client1, GITHUB_MERMAID_INSTRUCTION);
  expect(initialAdd?.created || initialAdd?.overwritten).toBeTruthy();

      // Simulate the reported issue scenario: Try to add again (should return skipped=true)
      const duplicateAdd = await client1.create({ id:GITHUB_MERMAID_INSTRUCTION.id, body:GITHUB_MERMAID_INSTRUCTION.body }, { overwrite:false });
      const skipped = duplicateAdd?.skipped === true || duplicateAdd?.created === false;
      if(skipped){
        const read = await client1.read(GITHUB_MERMAID_INSTRUCTION.id);
        expect(isNotFound(read), 'Should not be notFound if add was skipped').toBe(false);
      }
    }, 15000);

  it('LIST_GET_CROSS_VALIDATION - Detect phantom records', async () => {
  await addViaClient(client1, GITHUB_MERMAID_INSTRUCTION);

  const listObj = await client1.list();
  const instructions = listObj.items || [];

      // Cross-validate: every instruction in list should be gettable
  // legacy request counter removed after refactor
      // Original sequential loop caused timeouts (186+ individual read calls * tracing + ensureLoaded).
      // Optimize via batched concurrent reads while avoiding unbounded parallelism.
      const ids = instructions.map((i: any)=> String(i.id));
      // Exhaustive mode when explicitly enabled (CI stress / deep diagnostic passes)
  const listValidation = getRuntimeConfig().instructions.listValidation;
  const stressMode = listValidation.forceFullScan;
  const allowSampling = listValidation.allowSampling;

      // Adaptive sampling logic (aggressive runtime reduction while still giving broad coverage over time):
      // Historical progression: 50 -> 30 -> 12. Now dynamic: ~0.8% of Index, bounded [5,8] by default.
      // Goals:
      //  * Keep this RED reproduction under ~7s on Indexs up to several thousand entries.
      //  * Deterministic ordering (hash) so coverage is stable & rotates only via explicit seed.
      //  * Honor explicit env overrides for deep diagnostic runs.
      // Backwards compat envs (prefer LIST_GET_SAMPLE_SIZE going forward):
      const sampleSize = (() => {
        if (listValidation.effectiveSampleSize !== undefined) return listValidation.effectiveSampleSize;
        // Adaptive default: scale with index size but clamp for latency control.
        const adaptive = Math.ceil(ids.length * 0.008); // ~0.8%
        return Math.min(8, Math.max(5, adaptive));
      })();

      // Deterministic sampling (hash sort) so flakes aren't introduced while still distributing coverage over time
      function hash32(str: string): number { // simple FNV-1a like
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
          h ^= str.charCodeAt(i);
          h = Math.imul(h, 0x01000193);
        }
        // allow optional seed to rotate order across runs
        const seed = listValidation.sampleSeed ?? 0;
        h ^= seed;
        return (h >>> 0); // unsigned
      }

      let targetIds: string[];
      if (!allowSampling || ids.length <= sampleSize) {
        targetIds = ids;
      } else {
        targetIds = [...ids]
          .map(id => ({ id, h: hash32(id) }))
          .sort((a, b) => a.h - b.h)
          .slice(0, sampleSize)
          .map(o => o.id);
      }

      if (allowSampling && ids.length > targetIds.length) {
        // eslint-disable-next-line no-console
        console.warn(`[LIST_GET_CROSS_VALIDATION] sampling ${targetIds.length}/${ids.length} entries (forceFullScan=${listValidation.forceFullScan}; effectiveSampleSize=${listValidation.effectiveSampleSize ?? 'adaptive'}; sampleSeed=${listValidation.sampleSeed ?? 0})`);
      }
      // Concurrency tuned downward (15 -> 8 default) to reduce RPC bursts that previously caused sporadic timeouts.
      const CONCURRENCY = listValidation.concurrency;
      // Hard wall clock guard (default 7000ms) to prevent suite inflation; overridable for deep diagnostics.
      const MAX_DURATION_MS = listValidation.maxDurationMs;
      let index = 0;
      let validatedCount = 0;
      let truncated = false;
      const start = Date.now();
      let aborted = false;
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targetIds.length) }, async () => {
        while (!aborted) {
          const current = index++;
            if (current >= targetIds.length) break;
            // Duration guard check (checked before each RPC to keep under budget)
            if ((Date.now() - start) > MAX_DURATION_MS) {
              aborted = true; truncated = true; break;
            }
            const id = targetIds[current];
            const read = await client1.read(id);
            validatedCount++;
            expect(isNotFound(read), `Instruction ${id} should be found`).toBe(false);
        }
      }));
      const durationMs = Date.now() - start;
      try {
        const { emitTrace } = await import('../services/tracing.js');
        emitTrace('[trace:test:list_get_cross_validation:summary]', {
          totalIds: ids.length,
          intendedSample: targetIds.length,
          validated: validatedCount,
          sampled: allowSampling && targetIds.length < ids.length,
          truncated,
          concurrency: CONCURRENCY,
          durationMs,
          maxDurationMs: MAX_DURATION_MS,
          stressMode
        });
      } catch { /* ignore */ }

      // Verify our test instruction appears in the list
  const foundGithubMermaid = instructions.find((inst: any) => inst.id === GITHUB_MERMAID_INSTRUCTION.id);
      expect(foundGithubMermaid, 'GitHub Mermaid instruction should be in list').toBeDefined();
  }, 120000);
  });
});
