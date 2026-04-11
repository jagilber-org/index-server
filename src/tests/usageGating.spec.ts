import { describe, it, expect, vi, beforeEach } from 'vitest';

// Direct unit tests for the feature-gating logic in features.ts
// INDEX_SERVER_FEATURES env var controls which features are active

describe('usageGating', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('hasFeature returns false when INDEX_SERVER_FEATURES is empty', async () => {
		delete process.env.INDEX_SERVER_FEATURES;
		const { hasFeature } = await import('../services/features.js');
		expect(hasFeature('usage')).toBe(false);
	});

	it('hasFeature returns true when INDEX_SERVER_FEATURES contains the feature', async () => {
		process.env.INDEX_SERVER_FEATURES = 'usage,drift';
		const { hasFeature } = await import('../services/features.js');
		expect(hasFeature('usage')).toBe(true);
		expect(hasFeature('drift')).toBe(true);
	});

	it('hasFeature returns false for features not in INDEX_SERVER_FEATURES', async () => {
		process.env.INDEX_SERVER_FEATURES = 'usage';
		const { hasFeature } = await import('../services/features.js');
		expect(hasFeature('drift')).toBe(false);
		expect(hasFeature('window')).toBe(false);
	});

	it('incrementCounter and getCounters work correctly', async () => {
		delete process.env.INDEX_SERVER_FEATURES;
		const { incrementCounter, getCounters } = await import('../services/features.js');
		const before = getCounters();
		const key = 'test:gating:' + Date.now();
		expect(before[key]).toBeUndefined();
		incrementCounter(key);
		expect(getCounters()[key]).toBe(1);
		incrementCounter(key, 5);
		expect(getCounters()[key]).toBe(6);
	});
});
