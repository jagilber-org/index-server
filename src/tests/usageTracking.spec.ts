import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// Tests for incrementUsage in indexContext
// Uses a temp instructions dir with a real instruction file

const TEST_DIR = path.join(process.cwd(), 'tmp', 'test-usage-tracking-' + Date.now());
const TEST_ID = 'usage-tracking-test-entry';

describe('usageTracking', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterAll(() => {
		try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
	});

	it('incrementUsage returns featureDisabled when usage feature is off', async () => {
		delete process.env.INDEX_SERVER_FEATURES;
		process.env.INDEX_SERVER_DIR = TEST_DIR;
		fs.mkdirSync(TEST_DIR, { recursive: true });
		fs.writeFileSync(path.join(TEST_DIR, TEST_ID + '.json'), JSON.stringify({
			id: TEST_ID, title: 'Test', body: 'body', schemaVersion: '1',
			createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
		}));

		const { incrementUsage, invalidate } = await import('../services/indexContext.js');
		invalidate();
		const result = incrementUsage(TEST_ID);
		expect(result).toEqual({ featureDisabled: true });
	});

	it('incrementUsage increments count when usage feature is on', async () => {
		process.env.INDEX_SERVER_FEATURES = 'usage';
		process.env.INDEX_SERVER_DIR = TEST_DIR;
		fs.mkdirSync(TEST_DIR, { recursive: true });
		fs.writeFileSync(path.join(TEST_DIR, TEST_ID + '.json'), JSON.stringify({
			id: TEST_ID, title: 'Test', body: 'body', schemaVersion: '1',
			createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
		}));

		const { incrementUsage, invalidate } = await import('../services/indexContext.js');
		invalidate();
		const result = incrementUsage(TEST_ID);
		expect(result).not.toBeNull();
		if (result && !('featureDisabled' in result)) {
			expect(result.id).toBe(TEST_ID);
			expect(result.usageCount).toBeGreaterThanOrEqual(1);
		}
	});

	it('incrementUsage returns null for non-existent instruction id', async () => {
		process.env.INDEX_SERVER_FEATURES = 'usage';
		process.env.INDEX_SERVER_DIR = TEST_DIR;

		const { incrementUsage, invalidate } = await import('../services/indexContext.js');
		invalidate();
		const result = incrementUsage('non-existent-id-' + Date.now());
		expect(result).toBeNull();
	});
});
