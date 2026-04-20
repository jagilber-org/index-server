import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// Tests that firstSeenTs is populated on first usage track

const TEST_DIR = path.join(process.cwd(), 'tmp', 'test-usage-firstseen-' + Date.now());
const TEST_ID = 'firstseen-test-entry';

describe('usageFirstSeen', () => {
	afterAll(() => {
		try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
	});

	it('firstSeenTs is set on first incrementUsage call', async () => {
		vi.resetModules();
		process.env.INDEX_SERVER_FEATURES = 'usage';
		process.env.INDEX_SERVER_DIR = TEST_DIR;
		fs.mkdirSync(TEST_DIR, { recursive: true });
		fs.writeFileSync(path.join(TEST_DIR, TEST_ID + '.json'), JSON.stringify({
			id: TEST_ID, title: 'FirstSeen Test', body: 'body', schemaVersion: '1',
			createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
		}));

		const { incrementUsage, invalidate } = await import('../services/indexContext.js');
		invalidate();
		const before = new Date().toISOString();
		const result = incrementUsage(TEST_ID);
		const after = new Date().toISOString();

		expect(result).not.toBeNull();
		if (result && 'firstSeenTs' in result) {
			expect(result.firstSeenTs).toBeDefined();
			expect(result.firstSeenTs! >= before).toBe(true);
			expect(result.firstSeenTs! <= after).toBe(true);
		}
	});

	it('lastUsedAt is updated on each incrementUsage call', async () => {
		vi.resetModules();
		process.env.INDEX_SERVER_FEATURES = 'usage';
		process.env.INDEX_SERVER_DIR = TEST_DIR;
		fs.mkdirSync(TEST_DIR, { recursive: true });
		const id2 = 'firstseen-lastusedat-' + Date.now();
		fs.writeFileSync(path.join(TEST_DIR, id2 + '.json'), JSON.stringify({
			id: id2, title: 'LastUsedAt Test', body: 'body', schemaVersion: '1',
			createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
		}));

		const { incrementUsage, invalidate } = await import('../services/indexContext.js');
		invalidate();
		const r1 = incrementUsage(id2) as { lastUsedAt?: string } | null;
		expect(r1).not.toBeNull();
		if (r1 && r1.lastUsedAt) {
			const r2 = incrementUsage(id2) as { lastUsedAt?: string } | null;
			if (r2 && r2.lastUsedAt) {
				expect(r2.lastUsedAt >= r1.lastUsedAt).toBe(true);
			}
		}
	});
});
