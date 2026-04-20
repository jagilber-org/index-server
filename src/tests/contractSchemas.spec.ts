/**
 * Minimal contract schema presence test.
 * Validates that the SDK-based test client helper module loads and exports correctly.
 */
import { describe, it, expect } from 'vitest';
import { createTestClient, spawnServer } from './helpers/mcpTestClient.js';

describe('contract schemas smoke', () => {
	it('loads mcpTestClient helper exports', () => {
		expect(typeof createTestClient).toBe('function');
		expect(typeof spawnServer).toBe('function');
	});
});
