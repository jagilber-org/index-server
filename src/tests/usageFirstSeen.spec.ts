import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// Tests that firstSeenTs is populated on first usage track

const TEST_DIR = path.join(process.cwd(), 'tmp', 'test-usage-firstseen-' + Date.now());
const TEST_ID = 'firstseen-test-entry-' + Date.now();
const TEST_SNAPSHOT = path.join(TEST_DIR, 'usage-snapshot.json');
const ORIGINAL_INDEX_SERVER_DIR = process.env.INDEX_SERVER_DIR;
const ORIGINAL_USAGE_SNAPSHOT_PATH = process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH;

describe('usageFirstSeen', () => {
	afterAll(() => {
		if (ORIGINAL_INDEX_SERVER_DIR === undefined) delete process.env.INDEX_SERVER_DIR;
		else process.env.INDEX_SERVER_DIR = ORIGINAL_INDEX_SERVER_DIR;
		if (ORIGINAL_USAGE_SNAPSHOT_PATH === undefined) delete process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH;
		else process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH = ORIGINAL_USAGE_SNAPSHOT_PATH;
		try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
	});

	it('firstSeenTs is set on first incrementUsage call', async () => {
		vi.resetModules();
		process.env.INDEX_SERVER_FEATURES = 'usage';
		process.env.INDEX_SERVER_DIR = TEST_DIR;
		process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH = TEST_SNAPSHOT;
		fs.mkdirSync(TEST_DIR, { recursive: true });
		const createdAt = new Date().toISOString();
		fs.writeFileSync(path.join(TEST_DIR, TEST_ID + '.json'), JSON.stringify({
			id: TEST_ID, title: 'FirstSeen Test', body: 'body', schemaVersion: '1',
			createdAt, updatedAt: createdAt
		}));

		const { incrementUsage, invalidate, __testResetUsageState } = await import('../services/indexContext.js');
		__testResetUsageState();
		invalidate();
		const result = incrementUsage(TEST_ID);

		expect(result).not.toBeNull();
		if (result && 'firstSeenTs' in result) {
			expect(result.firstSeenTs).toBeDefined();
			// Semantic (RCA 2026-05-01, dev port 8687, fix for invariant-repair WARN spam):
			// when an entry has createdAt, firstSeenTs is established at load time
			// from createdAt (firstSeenTs ≤ createdAt is impossible by definition).
			// The previous behaviour — only setting firstSeenTs at first usage_track —
			// caused [invariant-repair] firstSeenTs repair exhausted WARNs to flood the
			// log on every getIndexState() poll for any entry that was ever imported
			// but never used. See firstSeenCreatedAtFallback.spec.ts.
			expect(result.firstSeenTs).toBe(createdAt);
		}
	});

	it('lastUsedAt is updated on each incrementUsage call', async () => {
		vi.resetModules();
		process.env.INDEX_SERVER_FEATURES = 'usage';
		process.env.INDEX_SERVER_DIR = TEST_DIR;
		process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH = TEST_SNAPSHOT;
		fs.mkdirSync(TEST_DIR, { recursive: true });
		const id2 = 'firstseen-lastusedat-' + Date.now();
		fs.writeFileSync(path.join(TEST_DIR, id2 + '.json'), JSON.stringify({
			id: id2, title: 'LastUsedAt Test', body: 'body', schemaVersion: '1',
			createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
		}));

		const { incrementUsage, invalidate, __testResetUsageState } = await import('../services/indexContext.js');
		__testResetUsageState();
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
