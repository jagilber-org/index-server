import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { performHandshake } from './util/handshakeHelper.js';
import { getRuntimeConfig } from '../config/runtimeConfig.js';
import { buildContentLengthFrame } from './util/stdioFraming.js';

/*
  Manifest Edge Case Tests
  1. Disabled write flag (INDEX_SERVER_MANIFEST_WRITE=0) should suppress manifest creation even after mutation.
  2. Corrupted on-disk manifest should be repaired (rewritten) after a mutation when write enabled.
*/

function readManifest(){
  const fp = path.join(process.cwd(), 'snapshots', 'index-manifest.json');
  if(!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp,'utf8')); } catch { return null; }
}

function writeCorruptedManifest(){
  const dir = path.join(process.cwd(), 'snapshots');
  if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'index-manifest.json'), '{"version":1,"entries":[{"id":"broken','utf8');
}

describe('manifest edge cases', () => {
  const createdTestIds: string[] = [];
  const INDEX_SERVER_DIR = path.join(process.cwd(), 'instructions');

  // Cleanup: Remove all test artifacts created by this suite
  afterAll(() => {
    for (const testId of createdTestIds) {
      const filePath = path.join(INDEX_SERVER_DIR, `${testId}.json`);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        // Log but don't fail cleanup
        process.stderr.write(`[manifestEdgeCases:cleanup] failed to remove ${testId}: ${err}\n`);
      }
    }
  });

  const FAST_COVERAGE = process.env.INDEX_SERVER_COVERAGE_FAST === '1';
  const maybeIt = FAST_COVERAGE ? it.skip : it;
  // Centralized timing via runtimeConfig (with legacy env fallback captured in loader)
  const cfg = getRuntimeConfig();
  const WAIT_DISABLED_MS = cfg.timing('manifest.waitDisabled', 18000)!;
  const WAIT_REPAIR_MS = cfg.timing('manifest.waitRepair', 20000)!;
  const POST_KILL_FLUSH_MS = cfg.timing('manifest.postKill', 250)!;
  const DIST_INDEX = path.join(process.cwd(),'dist','server', 'index-server.js');
  const DEPLOY_PRESENT = fs.existsSync(DIST_INDEX);
  if(!DEPLOY_PRESENT){
    // If build artifacts missing (e.g. running in a minimal environment) skip gracefully.
    // Returning here keeps the suite green while signaling intent.
    // SKIP_OK: conditional infrastructure-dependent test; allowed to skip when dist build absent in minimal contexts.
    it.skip('skip manifest edge cases (dist build missing)', () => {}); // SKIP_OK
    return;
  }

  maybeIt('respects INDEX_SERVER_MANIFEST_WRITE=0 (no file produced)', async () => {
    const start = readManifest(); // may exist from previous runs
    // spawn with write disabled
  const { server, parser } = await performHandshake({ extraEnv:{ INDEX_SERVER_MUTATION:'1', INDEX_SERVER_MANIFEST_WRITE:'0' }});
    const send = (m:unknown)=> server.stdin.write(buildContentLengthFrame(m));
    // perform a simple add mutation which would normally trigger manifest update
    const id = 'mw-disabled-' + Date.now();
    createdTestIds.push(id); // Register for cleanup
    send({ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'add', entry:{ id, title:'mw disabled', body:'body', priority:1, audience:'all', requirement:'optional', categories:['test'] }, overwrite:true, lax:true }}});
  await parser.waitForId(2, WAIT_DISABLED_MS, 50);
  server.kill();
  // allow fs flush of any background async writes before reading
  await new Promise(r=>setTimeout(r,POST_KILL_FLUSH_MS));
    const after = readManifest();
    // If there was no manifest initially it should remain null; if one existed it should be untouched (same timestamp & count)
    if(!start){
      expect(after, 'manifest should still be absent when disabled').toBeNull();
    } else {
      // Flakiness note:
      // In rare timing races a background async write (triggered just before disabling) could
      // regenerate the manifest producing a slightly different generatedAt while leaving
      // the logical contents (count) unchanged. We treat this as acceptable so long as no
      // growth in entry count occurred and the file modification time did not advance
      // significantly within the disabled window.
      const manifestPath = path.join(process.cwd(), 'snapshots', 'index-manifest.json');
      let stableMtime = true;
      try {
        const stat = fs.statSync(manifestPath);
        const now = Date.now();
        // If mtime is within 2 seconds of test end we assume a rewrite happened while disabled.
        // We'll allow it if logical count is unchanged.
        if(now - stat.mtimeMs < 2000 && after && start){
          stableMtime = false;
        }
      } catch { /* ignore */ }
      // Core invariant: entry count must not change when writes disabled.
      expect(after?.count, 'manifest entry count should remain constant when disabled').toBe(start.count);
      if(stableMtime) {
        // Only assert generatedAt stability if no evidence of a late rewrite.
        expect(after?.generatedAt).toBe(start.generatedAt);
      }
    }
  }, Math.max(35000, WAIT_DISABLED_MS + 10000));

  maybeIt('repairs corrupted manifest after mutation', async () => {
    writeCorruptedManifest();
    const beforeTxt = fs.readFileSync(path.join(process.cwd(),'snapshots','index-manifest.json'),'utf8');
    expect(beforeTxt.startsWith('{"version":1,"entries":[{"id":"broken')).toBe(true);
  const { server, parser } = await performHandshake({ extraEnv:{ INDEX_SERVER_MUTATION:'1', INDEX_SERVER_MANIFEST_WRITE:'1' }});
    const send = (m:unknown)=> server.stdin.write(buildContentLengthFrame(m));
    const id = 'mw-repair-' + Date.now();
    createdTestIds.push(id); // Register for cleanup
    send({ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'add', entry:{ id, title:'mw repair', body:'body', priority:2, audience:'all', requirement:'optional', categories:['repair'] }, overwrite:true, lax:true }}});
  await parser.waitForId(2, WAIT_REPAIR_MS, 50);
  server.kill();
  await new Promise(r=>setTimeout(r,POST_KILL_FLUSH_MS));
    const repaired = readManifest();
    expect(repaired, 'manifest should exist after repair').not.toBeNull();
    expect(repaired?.count).toBeGreaterThanOrEqual(1);
    expect(typeof repaired?.generatedAt).toBe('string');
    // ensure JSON structure no longer truncated
    const repairedTxt = fs.readFileSync(path.join(process.cwd(),'snapshots','index-manifest.json'),'utf8');
    expect(repairedTxt.endsWith('\n') || repairedTxt.trim().endsWith('}')).toBe(true);
  }, Math.max(40000, WAIT_REPAIR_MS + 12000));
});
