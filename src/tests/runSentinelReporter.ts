import type { Reporter, Vitest, File } from 'vitest';
import fs from 'fs';
import path from 'path';

// Minimal custom reporter that writes a deterministic sentinel when the entire test run finishes.
// Provides both a unique marker and stable file names for polling automation.
export default class RunSentinelReporter implements Reporter {
  start = Date.now();
  ctx!: Vitest;
  onInit(ctx: Vitest){
    this.ctx = ctx;
  }
  onFinished(files: File[], errors: unknown[]) {
    const end = Date.now();
    const durationMs = end - this.start;
    const root = process.cwd();
    // Derive aggregate test stats
    let testsTotal = 0;
    let testsFailed = 0;
    type TaskNode = File & { tasks?: TaskNode[] } | { type: string; tasks?: TaskNode[]; result?: { state?: string } };
    for (const f of files){
      const stack: TaskNode[] = [f as TaskNode];
      while(stack.length){
        const t = stack.pop()!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if((t as any).type === 'test'){
          testsTotal++;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if((t as any).result?.state === 'fail') testsFailed++;
        }
        if(t.tasks) stack.push(...t.tasks);
      }
    }
    const summary = {
      started: this.start,
      ended: end,
      durationMs,
      node: process.version,
      filesTotal: files.length,
      filesFailed: files.filter(f=>f.result?.state==='fail').length,
      testsTotal,
      testsFailed,
      errors: errors.length,
    };
    const uniqueName = `.test-run-complete.${end}.marker`;
    try {
      fs.writeFileSync(path.join(root, uniqueName), JSON.stringify(summary,null,2));
      fs.writeFileSync(path.join(root, '.test-run-complete.latest'), uniqueName,'utf8');
      fs.writeFileSync(path.join(root, '.test-run-status.json'), JSON.stringify(summary,null,2));
      // eslint-disable-next-line no-console
      console.log(`[runSentinelReporter] wrote ${uniqueName} (duration=${durationMs}ms)`);
    } catch(err){
      // eslint-disable-next-line no-console
      console.error('[runSentinelReporter] failed to write sentinel:', (err as Error).message);
    }
  }
}
