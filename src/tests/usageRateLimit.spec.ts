import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// Tests that rate limiting in usage tracking behaves correctly

const TEST_DIR = path.join(process.cwd(), 'tmp', 'test-usage-ratelimit-' + Date.now());

describe('usageRateLimit', () => {
	afterAll(() => {
		try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
	});

	it('clearUsageRateLimit resets rate limit state for an id', async () => {
		vi.resetModules();
		process.env.INDEX_SERVER_FEATURES = 'usage';
		process.env.INDEX_SERVER_DIR = TEST_DIR;
		fs.mkdirSync(TEST_DIR, { recursive: true });
		const testId = 'ratelimit-clear-' + Date.now();
		fs.writeFileSync(path.join(TEST_DIR, testId + '.json'), JSON.stringify({
			id: testId, title: 'RateLimit Test', body: 'body', schemaVersion: '1',
			createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
		}));

		const { incrementUsage, clearUsageRateLimit, invalidate } = await import('../services/indexContext.js');
		invalidate();

		// First call should succeed
		const r1 = incrementUsage(testId);
		expect(r1).not.toBeNull();
		if (r1 && 'usageCount' in r1) {
			expect(r1.usageCount).toBeGreaterThanOrEqual(1);
		}

		// Clear rate limit and call again — should still succeed
		clearUsageRateLimit(testId);
		const r2 = incrementUsage(testId);
		expect(r2).not.toBeNull();
		if (r2 && 'usageCount' in r2) {
			expect(r2.usageCount).toBeGreaterThanOrEqual(1);
		}
	});

	it('clearUsageRateLimit with no arg resets all rate limits', async () => {
		vi.resetModules();
		process.env.INDEX_SERVER_FEATURES = 'usage';
		process.env.INDEX_SERVER_DIR = TEST_DIR;
		fs.mkdirSync(TEST_DIR, { recursive: true });
		const testId = 'ratelimit-clearall-' + Date.now();
		fs.writeFileSync(path.join(TEST_DIR, testId + '.json'), JSON.stringify({
			id: testId, title: 'RateLimit ClearAll', body: 'body', schemaVersion: '1',
			createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
		}));

		const { incrementUsage, clearUsageRateLimit, invalidate } = await import('../services/indexContext.js');
		invalidate();

		const r1 = incrementUsage(testId);
		expect(r1).not.toBeNull();

		// Clear all rate limits
		clearUsageRateLimit();

		const r2 = incrementUsage(testId);
		expect(r2).not.toBeNull();
		if (r2 && 'usageCount' in r2) {
			expect(r2.usageCount).toBeGreaterThanOrEqual(1);
		}
	});
});
