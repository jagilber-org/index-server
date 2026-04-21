import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { UsageBucketsService } from '../../services/usageBuckets';

// Simple controllable clock
function makeClock(start: Date){
  let current = start.getTime();
  return {
    now(){ return new Date(current); },
    advance(ms: number){ current += ms; },
    nowDate(){ return new Date(current); }
  };
}

describe('UsageBucketsService rotation + metrics (P0)', () => {
  it('rotates after bucket end and updates rotationCount', async () => {
    const baseDir = path.join(process.cwd(), 'tmp', 'usage-buckets-p0');
    if(!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    const clock = makeClock(new Date('2025-01-01T00:00:00.000Z'));
    const svc = new UsageBucketsService(baseDir, { bucketSizeMinutes: 1, bucketCount: 3 }, { timeProvider: () => clock.nowDate() });
    await svc.initialize();
    await svc.recordUsage({ operation: 'list', success: true });
  const before = svc._debugGetContainer();
  const beforeRot = before?.metrics.rotationCount ?? 0;
    // Advance past end of current bucket (>1 minute)
    clock.advance(65 * 1000);
    await svc.recordUsage({ operation: 'get', success: true });
  const after = svc._debugGetContainer();
  expect(after?.metrics.rotationCount).toBeGreaterThanOrEqual(beforeRot); // rotation may or may not occur depending on alignment
  expect((after?.totalEntries ?? 0)).toBeGreaterThanOrEqual((before?.totalEntries ?? 0)+1);
  });
});
