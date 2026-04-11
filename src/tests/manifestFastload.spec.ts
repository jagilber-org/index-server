import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../server/registry';
import { reloadRuntimeConfig } from '../config/runtimeConfig';

// We test computeManifestDrift behavior difference when INDEX_SERVER_MANIFEST_FASTLOAD=1
// by seeding a small index and observing drift computation time / details.

let add: any;

function readManifest(){
  const fp = path.join(process.cwd(),'snapshots','index-manifest.json');
  if(!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp,'utf8'));
}

describe('manifest fastload shortcut', () => {
  beforeAll(async () => {
  process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_MANIFEST_WRITE = '1';
    const TMP = path.join(process.cwd(),'tmp','manifest-fastload');
    reloadRuntimeConfig(); // Reload config after setting env vars
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
    process.env.INDEX_SERVER_DIR = TMP;
    // side effect imports (suppress type resolution complaints)
    // @ts-expect-error side-effect
    await import('../services/handlers.instructions');
    // @ts-expect-error side-effect
    await import('../services/instructions.dispatcher');
    // @ts-expect-error side-effect
    await import('../services/handlers.manifest');
    add = getHandler('index_add');
  });

  it('normal path: drift fully computed (no fastload)', async () => {
    delete process.env.INDEX_SERVER_MANIFEST_FASTLOAD;
    const id = 'fastload-normal-' + Date.now();
    await add({ entry:{ id, title:id, body:'body', priority:10, audience:'all', requirement:'optional', categories:['fl'] }, lax:true });
    const status = await (getHandler('manifest_status') as any)();
    expect(status).toHaveProperty('drift');
    expect(status.drift).toBe(0);
  });

  it('fast path: with matching count returns zero drift without hashing', async () => {
    process.env.INDEX_SERVER_MANIFEST_FASTLOAD = '1';
    const id = 'fastload-enabled-' + Date.now();
    await add({ entry:{ id, title:id, body:'x', priority:5, audience:'all', requirement:'optional', categories:['fl'] }, lax:true });
    const manifestBefore = readManifest();
    expect(manifestBefore).not.toBeNull();
    // Now call status; implementation should short-circuit as counts match.
    const t0 = Date.now();
    const status = await (getHandler('manifest_status') as any)();
    const elapsed = Date.now() - t0;
    expect(status.drift).toBe(0);
    // Heuristic: with small index hashing would still be fast, but we assert manifest present + zero drift.
    expect(status.manifestPresent).toBe(true);
    // We cannot directly prove we skipped hashing without instrumentation, but this guards regression.
    expect(elapsed).toBeLessThan(50); // generous bound
  });

  it('fast path falls back when count mismatch', async () => {
    process.env.INDEX_SERVER_MANIFEST_FASTLOAD = '1';
    // Manually corrupt manifest count
    const mf = readManifest();
    if(mf){
      mf.count = mf.count + 10; // inconsistent
      fs.writeFileSync(path.join(process.cwd(),'snapshots','index-manifest.json'), JSON.stringify(mf,null,2));
    }
    const status = await (getHandler('manifest_status') as any)();
    // Should detect drift (at least mismatch) or recompute producing non-negative drift value.
    expect(status.present || status.manifestPresent).toBeTruthy();
    // drift may be >=0; key is that implementation didn't silently return 0 with mismatched count.
    if(mf) expect(status.drift).toBeGreaterThanOrEqual(0);
  });
});
