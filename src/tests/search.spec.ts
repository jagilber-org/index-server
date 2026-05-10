/**
 * Test Suite for MCP Instructions Search Tool
 *
 * Validates the index_search tool functionality including:
 * - Keyword matching against titles, bodies, and categories
 * - Case sensitivity options
 * - Input validation and error handling
 * - MCP protocol compliance
 * - Performance with large instruction sets
 * - Relevance scoring accuracy
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleInstructionsSearch } from '../services/handlers.search';
import { isSemanticError } from '../services/errors';
import { InstructionEntry } from '../models/instruction';

// Mutable flag for controlling semantic-enabled mock per test
let mockSemanticEnabled = false;

// Mock runtimeConfig to allow toggling semantic.enabled in tests
vi.mock('../config/runtimeConfig', async (importOriginal) => {
  const original = await importOriginal<typeof import('../config/runtimeConfig')>();
  return {
    ...original,
    getRuntimeConfig: () => {
      const realConfig = original.getRuntimeConfig();
      if (mockSemanticEnabled) {
        return { ...realConfig, semantic: { ...realConfig.semantic, enabled: true } };
      }
      return realConfig;
    }
  };
});

// Mock embeddingService so semantic search doesn't require a real model
vi.mock('../services/embeddingService', () => ({
  embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  getInstructionEmbeddings: vi.fn().mockResolvedValue({}),
  cosineSimilarity: vi.fn().mockReturnValue(0),
}));

// Mock instruction index for testing
const mockInstructions: InstructionEntry[] = [
  {
    id: 'test-001',
    title: 'JavaScript Array Methods',
    body: 'Learn about map, filter, reduce, and forEach methods for JavaScript arrays. These are essential functional programming techniques.',
    priority: 10,
    audience: 'all',
    requirement: 'recommended',
    categories: ['javascript', 'programming', 'arrays'],
    contentType: 'instruction',
    sourceHash: 'hash1',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  },
  {
    id: 'test-002',
    title: 'TypeScript Interface Design',
    body: 'Best practices for designing TypeScript interfaces. Include proper typing for complex objects and union types.',
    priority: 5,
    audience: 'all',
    requirement: 'mandatory',
    categories: ['typescript', 'programming', 'interfaces'],
    contentType: 'instruction',
    sourceHash: 'hash2',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  },
  {
    id: 'test-003',
    title: 'React Component Lifecycle',
    body: 'Understanding React component lifecycle methods and hooks. Learn useEffect, useState, and custom hooks.',
    priority: 15,
    audience: 'all',
    requirement: 'recommended',
    categories: ['react', 'frontend', 'javascript'],
    contentType: 'instruction',
    sourceHash: 'hash3',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  },
  {
    id: 'test-004',
    title: 'Database Query Optimization',
    body: 'Techniques for optimizing SQL queries and database performance. Focus on indexing and query planning.',
    priority: 8,
    audience: 'all',
    requirement: 'critical',
    categories: ['database', 'sql', 'performance'],
    contentType: 'instruction',
    sourceHash: 'hash4',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  },
  {
    id: 'test-005',
    title: 'API Security Best Practices',
    body: 'Security considerations for REST APIs including authentication, authorization, and data validation.',
    priority: 3,
    audience: 'all',
    requirement: 'mandatory',
    categories: ['security', 'api', 'backend'],
    contentType: 'instruction',
    sourceHash: 'hash5',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  },
  {
    id: 'service-mesh-runbook',
    title: 'Mesh Traffic Guide',
    body: 'Traffic policy guidance for proxies and ingress controllers.',
    priority: 7,
    audience: 'all',
    requirement: 'recommended',
    categories: ['networking', 'platform'],
    contentType: 'instruction',
    sourceHash: 'hash6',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  },
  {
    id: 'test-007',
    title: 'Traffic Control Notes',
    body: 'Proxy lifecycle troubleshooting and rollout safety checks.',
    semanticSummary: 'Cluster certificate rotation playbook',
    priority: 6,
    audience: 'all',
    requirement: 'recommended',
    categories: ['operations', 'certificates'],
    contentType: 'instruction',
    sourceHash: 'hash7',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  },
  {
    id: 'test-008',
    title: 'Governance Notes',
    body: 'Template migration notes for maintainers. Repo lifecycle guidance appears separately. Constitution review steps are in the appendix.',
    priority: 9,
    audience: 'all',
    requirement: 'recommended',
    categories: ['governance', 'templates'],
    contentType: 'instruction',
    sourceHash: 'hash8',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  },
  {
    id: 'test-009',
    title: 'Governance Notes',
    body: 'Template repo governance constitution checklist for maintainers.',
    priority: 4,
    audience: 'all',
    requirement: 'recommended',
    categories: ['governance', 'templates'],
    contentType: 'instruction',
    sourceHash: 'hash9',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  },
  {
    id: 'test-010',
    title: 'Governance Workflow Security Guide',
    body: 'Governance workflow security copilot guidance for repositories and maintainers.',
    priority: 5,
    audience: 'all',
    requirement: 'recommended',
    categories: ['governance', 'security', 'workflow'],
    contentType: 'instruction',
    sourceHash: 'hash10',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  },
  {
    id: 'test-011',
    title: 'Copilot Security Workflow Playbook',
    body: 'Copilot governance workflow security setup for repositories and maintainers.',
    priority: 5,
    audience: 'all',
    requirement: 'recommended',
    categories: ['agents', 'copilot', 'security', 'workflow'],
    contentType: 'instruction',
    sourceHash: 'hash11',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  },
  {
    id: 'test-012',
    title: 'Security Workflow Checklist',
    body: 'Security workflow steps for repository maintainers.',
    priority: 4,
    audience: 'all',
    requirement: 'recommended',
    categories: ['security', 'workflow'],
    contentType: 'instruction',
    sourceHash: 'hash12',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  },
  {
    id: 'test-013',
    title: 'Governance Overview',
    body: 'Governance workflow for template repositories.',
    priority: 4,
    audience: 'all',
    requirement: 'recommended',
    categories: ['governance', 'workflow'],
    contentType: 'instruction',
    sourceHash: 'hash13',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  },
  {
    id: 'test-014',
    title: 'Repository Security Governance',
    body: 'Repository security governance baseline and workflow guidance.',
    priority: 4,
    audience: 'all',
    requirement: 'recommended',
    categories: ['governance', 'security', 'workflow'],
    contentType: 'instruction',
    sourceHash: 'hash14',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  }
];

// Mock the index context
vi.mock('../services/indexContext', () => ({
  ensureLoaded: () => ({
    list: mockInstructions,
    hash: 'test-hash'
  })
}));

describe('Instructions Search Tool', () => {
  beforeEach(() => {
    // Reset any environment variables
    delete process.env.INDEX_SERVER_LOG_SEARCH;
  });

  afterEach(() => {
    // Cleanup if needed
  });

  describe('Basic Search Functionality', () => {
    it('should find instructions by exact instruction id', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['service-mesh-runbook']
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].instructionId).toBe('service-mesh-runbook');
      expect(result.results[0].matchedFields).toContain('id');
    });

    it('should normalize separators when matching instruction ids', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['service mesh runbook']
      });

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].instructionId).toBe('service-mesh-runbook');
      expect(result.results[0].matchedFields).toContain('id');
    });

    it('should find instructions by title keyword', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['JavaScript']
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].instructionId).toBe('test-001'); // Title match: "JavaScript Array Methods"
      expect(result.totalMatches).toBe(1);
    });

    it('should find instructions by body keyword', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['optimization']
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].instructionId).toBe('test-004');
      expect(result.results[0].matchedFields).toContain('title'); // "optimization" appears in title too
    });

    it('should find instructions by semantic summary keyword', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['certificate rotation']
      });

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].instructionId).toBe('test-007');
      expect(result.results[0].matchedFields).toContain('semanticSummary');
    });

    it('should find instructions by category when includeCategories is true', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['security'],
        includeCategories: true
      });

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results.some(r => r.instructionId === 'test-005')).toBe(true);
      expect(result.results.find(r => r.instructionId === 'test-005')!.matchedFields).toContain('categories');
    });

    it('should not search categories when includeCategories is false', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['sql'],
        includeCategories: false
      });

      expect(result.results).toHaveLength(1); // "SQL" appears in test-004 body
      expect(result.results[0].instructionId).toBe('test-004');
      expect(result.results[0].matchedFields).toContain('body');
    });
  });

  describe('Multiple Keyword Search', () => {
    it('should handle multiple keywords with AND logic', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['TypeScript', 'interface']
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].instructionId).toBe('test-002');
      expect(result.results[0].relevanceScore).toBeGreaterThan(10); // Bonus for multiple matches
    });

    it('should rank results by relevance score', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['programming'],
        includeCategories: true
      });

      expect(result.results.length).toBeGreaterThan(1);
      // Results should be sorted by relevance score descending
      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i-1].relevanceScore).toBeGreaterThanOrEqual(result.results[i].relevanceScore);
      }
    });

    it('should favor results where multiple keywords occur closer together', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['template', 'repo', 'constitution']
      });

      expect(result.results.length).toBeGreaterThan(1);
      expect(result.results[0].instructionId).toBe('test-009');
      expect(result.results.find(r => r.instructionId === 'test-008')).toBeDefined();
      expect(result.results[0].relevanceScore).toBeGreaterThan(
        result.results.find(r => r.instructionId === 'test-008')!.relevanceScore
      );
    });

    it('should favor rarer keyword coverage over generic repeated terms', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['workflow', 'governance', 'security', 'copilot']
      });

      expect(result.results.length).toBeGreaterThan(1);
      expect(result.results[0].instructionId).toBe('test-011');
      expect(result.results.find(r => r.instructionId === 'test-010')).toBeDefined();
      expect(result.results[0].relevanceScore).toBeGreaterThan(
        result.results.find(r => r.instructionId === 'test-010')!.relevanceScore
      );
    });
  });

  describe('Case Sensitivity', () => {
    it('should be case-insensitive by default', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['javascript']
      });

      expect(result.results).toHaveLength(1); // Only finds test-001 title match, not categories
      expect(result.results[0].instructionId).toBe('test-001');
      expect(result.query.caseSensitive).toBe(false);
    });

    it('should respect case sensitivity when enabled', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['javascript'], // lowercase
        caseSensitive: true,
        includeCategories: true // Need this to find category matches
      });

      // Should find lowercase matches in categories, not title "JavaScript"
      expect(result.results).toHaveLength(2); // test-001 and test-003 both have lowercase 'javascript' in categories
      expect(result.results.map(r => r.instructionId).sort()).toEqual(['test-001', 'test-003']);
    });
  });

  describe('Input Validation', () => {
    it('should require keywords parameter', async () => {
      await expect(handleInstructionsSearch({} as any)).rejects.toThrow('Invalid keywords: expected array');
    });

    it('should require keywords to be an array', async () => {
      await expect(handleInstructionsSearch({ keywords: 'not-array' } as any)).rejects.toThrow('Invalid keywords: expected array');
    });

    it('should reject empty keywords array', async () => {
      await expect(handleInstructionsSearch({ keywords: [] })).rejects.toThrow('At least one keyword is required');
    });

    it('should reject non-string keywords', async () => {
      await expect(handleInstructionsSearch({ keywords: [123] } as any)).rejects.toThrow('All keywords must be strings');
    });

    it('should reject empty string keywords', async () => {
      await expect(handleInstructionsSearch({ keywords: ['', 'valid'] })).rejects.toThrow('Keywords cannot be empty');
    });

    it('should reject keywords longer than 100 characters', async () => {
      const longKeyword = 'a'.repeat(101);
      await expect(handleInstructionsSearch({ keywords: [longKeyword] })).rejects.toThrow('Keywords cannot exceed 100 characters');
    });

    it('should enforce maximum 10 keywords', async () => {
      const tooManyKeywords = Array(11).fill('keyword');
      await expect(handleInstructionsSearch({ keywords: tooManyKeywords })).rejects.toThrow('Maximum 10 keywords allowed');
    });

    it('should validate limit parameter', async () => {
      await expect(handleInstructionsSearch({ keywords: ['test'], limit: 0 })).rejects.toThrow('Limit must be a number between 1 and 100');
      await expect(handleInstructionsSearch({ keywords: ['test'], limit: 101 })).rejects.toThrow('Limit must be a number between 1 and 100');
      await expect(handleInstructionsSearch({ keywords: ['test'], limit: 'invalid' } as any)).rejects.toThrow('Limit must be a number between 1 and 100');
    });

    it('should validate boolean parameters', async () => {
      await expect(handleInstructionsSearch({ keywords: ['test'], includeCategories: 'invalid' } as any)).rejects.toThrow('includeCategories must be a boolean');
      await expect(handleInstructionsSearch({ keywords: ['test'], caseSensitive: 'invalid' } as any)).rejects.toThrow('caseSensitive must be a boolean');
    });
  });

  describe('Limit and Pagination', () => {
    it('should apply default limit of 50', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['test'] // This won't match our mock data, but tests default
      });

      expect(result.query.limit).toBe(50);
    });

    it('should apply custom limit', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['programming'],
        includeCategories: true,
        limit: 2
      });

      expect(result.results.length).toBeLessThanOrEqual(2);
      expect(result.query.limit).toBe(2);
    });

    it('should enforce maximum limit of 100', async () => {
      await expect(handleInstructionsSearch({
        keywords: ['test'],
        limit: 150 // Should be rejected
      })).rejects.toThrow('Limit must be a number between 1 and 100');
    });
  });

  describe('Response Format', () => {
    it('should return proper response structure', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['JavaScript']
      });

      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('totalMatches');
      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('executionTimeMs');

      expect(Array.isArray(result.results)).toBe(true);
      expect(typeof result.totalMatches).toBe('number');
      expect(typeof result.executionTimeMs).toBe('number');

      if (result.results.length > 0) {
        const firstResult = result.results[0];
        expect(firstResult).toHaveProperty('instructionId');
        expect(firstResult).toHaveProperty('relevanceScore');
        expect(firstResult).toHaveProperty('matchedFields');
        expect(Array.isArray(firstResult.matchedFields)).toBe(true);
      }
    });

    it('should include query parameters in response', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['test'],
        limit: 25,
        includeCategories: true,
        caseSensitive: false
      });

      expect(result.query).toEqual({
        keywords: ['test'],
        mode: 'keyword',
        limit: 25,
        includeCategories: true,
        caseSensitive: false
      });
    });
  });

  describe('Performance', () => {
    it('should complete search within reasonable time', async () => {
      const start = Date.now();
      const result = await handleInstructionsSearch({
        keywords: ['programming']
      });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000); // Should complete within 1 second
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0); // Allow 0 for very fast searches
      expect(result.executionTimeMs).toBeLessThan(duration + 50); // Allow some measurement variance
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in keywords', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['@#$%^&*()']
      });

      expect(result.results).toHaveLength(0);
      expect(result.totalMatches).toBe(0);
    });

    it('should handle whitespace-only keywords by trimming them', async () => {
      await expect(handleInstructionsSearch({
        keywords: ['  JavaScript  ', '\t\n'] // Second keyword becomes empty after trim
      })).rejects.toThrow('Keywords cannot be empty');
    });

    it('should handle empty search results gracefully', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['nonexistentkeyword123']
      });

      expect(result.results).toHaveLength(0);
      expect(result.totalMatches).toBe(0);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0); // Allow 0 for very fast searches
    });
  });

  describe('Auto-Tokenization Fallback', () => {
    it('should auto-tokenize multi-word keyword when initial search returns no results', async () => {
      // "React hooks" as a single contiguous substring doesn't appear in any title/body,
      // but tokenized into ["React", "hooks"] both match test-003 (title has "React", body has "hooks")
      const result = await handleInstructionsSearch({
        keywords: ['React hooks']
      });

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.autoTokenized).toBe(true);
    });

    it('should not auto-tokenize when initial search already has results', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['JavaScript']
      });

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.autoTokenized).toBeUndefined();
    });

    it('should not auto-tokenize single-word keywords that have no matches', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['nonexistent']
      });

      expect(result.results).toHaveLength(0);
      expect(result.autoTokenized).toBeUndefined();
    });

    it('should deduplicate tokens during auto-tokenization', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['JavaScript JavaScript Array']
      });

      // Should deduplicate "JavaScript" and search with ["JavaScript", "Array"]
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.autoTokenized).toBe(true);
      // Query should contain deduplicated keywords
      expect(result.query.keywords).toHaveLength(2);
    });

    it('should return tokenized keywords in query field', async () => {
      // "React authentication" won't match as a contiguous substring,
      // but "React" matches test-003 and "authentication" matches test-005 body
      const result = await handleInstructionsSearch({
        keywords: ['React authentication']
      });

      expect(result.autoTokenized).toBe(true);
      expect(result.query.keywords).toEqual(
        expect.arrayContaining(['React', 'authentication'])
      );
    });
  });

  describe('Error Response Schema & Hints', () => {
    it('should include schema and hint in validation error for missing keywords', async () => {
      try {
        await handleInstructionsSearch({} as any);
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(isSemanticError(e)).toBe(true);
        const err = e as { code: number; message: string; data: Record<string, unknown> };
        expect(err.code).toBe(-32602);
        expect(err.message).toContain('Invalid keywords');
        expect(err.data).toHaveProperty('schema');
        expect(err.data).toHaveProperty('hint');
        expect(err.data).toHaveProperty('example');
        expect((err.data.schema as any).required).toContain('keywords');
        expect((err.data.example as any).keywords).toBeInstanceOf(Array);
      }
    });

    it('should include schema and hint in validation error for empty keywords', async () => {
      try {
        await handleInstructionsSearch({ keywords: [] });
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(isSemanticError(e)).toBe(true);
        const err = e as { code: number; data: Record<string, unknown> };
        expect(err.code).toBe(-32602);
        expect(err.data).toHaveProperty('schema');
        expect(err.data).toHaveProperty('hint');
        expect(typeof err.data.hint).toBe('string');
      }
    });

    it('should include schema and hint in validation error for invalid limit', async () => {
      try {
        await handleInstructionsSearch({ keywords: ['test'], limit: 999 });
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(isSemanticError(e)).toBe(true);
        const err = e as { code: number; message: string; data: Record<string, unknown> };
        expect(err.code).toBe(-32602);
        expect(err.message).toContain('Limit');
        expect(err.data.schema).toBeDefined();
      }
    });
  });

  describe('Zero-Result Hints', () => {
    it('should include hints when no results found', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['nonexistentkeyword123']
      });

      expect(result.results).toHaveLength(0);
      expect(result.hints).toBeDefined();
      expect(Array.isArray(result.hints)).toBe(true);
      expect(result.hints!.length).toBeGreaterThan(0);
    });

    it('should suggest includeCategories when not enabled', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['nonexistentkeyword123'],
        includeCategories: false
      });

      expect(result.hints).toBeDefined();
      expect(result.hints!.some(h => h.includes('includeCategories'))).toBe(true);
    });

    it('should not suggest includeCategories when already enabled', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['nonexistentkeyword123'],
        includeCategories: true
      });

      expect(result.hints).toBeDefined();
      expect(result.hints!.some(h => h.includes('includeCategories: true'))).toBe(false);
    });

    it('should suggest removing contentType filter when set', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['nonexistentkeyword123'],
        contentType: 'template'
      });

      expect(result.hints).toBeDefined();
      expect(result.hints!.some(h => h.includes('template'))).toBe(true);
    });

    it('should not include hints when results are found', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['JavaScript']
      });

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.hints).toBeUndefined();
    });

    it('should include hints on auto-tokenized retry with zero results', async () => {
      // "zzz qqq" won't match anything even after tokenization
      const result = await handleInstructionsSearch({
        keywords: ['zzznonexistent qqqnonexistent']
      });

      expect(result.autoTokenized).toBe(true);
      expect(result.results).toHaveLength(0);
      expect(result.hints).toBeDefined();
      expect(result.hints!.length).toBeGreaterThan(0);
    });
  });

  describe('Search Mode: regex', () => {
    it('should accept mode parameter', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['JavaScript'],
        mode: 'regex'
      });
      expect(result.query.mode).toBe('regex');
    });

    it('should default mode to keyword', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['JavaScript']
      });
      expect(result.query.mode).toBe('keyword');
    });

    it('should default mode to semantic when semantic is enabled', async () => {
      mockSemanticEnabled = true;
      try {
        const result = await handleInstructionsSearch({
          keywords: ['JavaScript']
        });
        expect(result.query.mode).toBe('semantic');
      } finally {
        mockSemanticEnabled = false;
      }
    });

    it('should match regex pattern in title when mode=regex', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['Java.*Array'],
        mode: 'regex'
      });
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].instructionId).toBe('test-001');
    });

    it('should match regex pattern in body when mode=regex', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['map.*reduce'],
        mode: 'regex'
      });
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].instructionId).toBe('test-001');
    });

    it('should support alternation patterns like "map|filter"', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['map|filter'],
        mode: 'regex'
      });
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].instructionId).toBe('test-001');
    });

    it('should support character class patterns like "Type[Ss]cript"', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['Type[Ss]cript'],
        mode: 'regex'
      });
      expect(result.results.length).toBeGreaterThan(0);
      // Should find test-002 (TypeScript Interface Design)
      expect(result.results.some(r => r.instructionId === 'test-002')).toBe(true);
    });

    it('should respect caseSensitive with regex mode', async () => {
      const resultInsensitive = await handleInstructionsSearch({
        keywords: ['javascript'],
        mode: 'regex',
        caseSensitive: false
      });
      const resultSensitive = await handleInstructionsSearch({
        keywords: ['javascript'],
        mode: 'regex',
        caseSensitive: true
      });
      // Case-insensitive should find "JavaScript" in title; case-sensitive "javascript" only in body/categories
      expect(resultInsensitive.results.length).toBeGreaterThanOrEqual(resultSensitive.results.length);
    });

    it('should NOT treat keywords as regex when mode=keyword', async () => {
      // "map.*reduce" won't match literally in any title/body
      const result = await handleInstructionsSearch({
        keywords: ['map.*reduce'],
        mode: 'keyword'
      });
      expect(result.results).toHaveLength(0);
    });

    it('should escape special chars in keyword mode (existing behavior)', async () => {
      // Parens are regex special chars but should be escaped in keyword mode
      const result = await handleInstructionsSearch({
        keywords: ['(test)'],
        mode: 'keyword'
      });
      expect(result.results).toHaveLength(0); // No literal "(test)" in any instruction
    });

    it('should return structured error for invalid regex pattern', async () => {
      try {
        await handleInstructionsSearch({
          keywords: ['[invalid'],
          mode: 'regex'
        });
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(isSemanticError(e)).toBe(true);
        const err = e as { code: number; message: string; data: Record<string, unknown> };
        expect(err.code).toBe(-32602);
        expect(err.message).toContain('regex');
      }
    });

    it('should reject regex patterns longer than 200 chars (ReDoS)', async () => {
      const longPattern = 'a'.repeat(201);
      try {
        await handleInstructionsSearch({
          keywords: [longPattern],
          mode: 'regex'
        });
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(isSemanticError(e)).toBe(true);
        const err = e as { code: number; message: string };
        expect(err.message).toContain('200');
      }
    });

    it('should reject valid regex patterns with catastrophic backtracking risk', async () => {
      try {
        await handleInstructionsSearch({
          keywords: ['(a?){25}a{25}'],
          mode: 'regex'
        });
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(isSemanticError(e)).toBe(true);
        const err = e as { code: number; message: string };
        expect(err.code).toBe(-32602);
        expect(err.message).toContain('catastrophic');
      }
    });

    it('should reject lookaround assertions in regex mode', async () => {
      try {
        await handleInstructionsSearch({
          keywords: ['(?=Java)JavaScript'],
          mode: 'regex'
        });
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(isSemanticError(e)).toBe(true);
        const err = e as { code: number; message: string };
        expect(err.code).toBe(-32602);
        expect(err.message).toContain('lookaround');
      }
    });

    it('should validate mode is valid enum value', async () => {
      try {
        await handleInstructionsSearch({
          keywords: ['test'],
          mode: 'invalid' as any
        });
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(isSemanticError(e)).toBe(true);
        const err = e as { code: number; message: string };
        expect(err.message).toContain('mode');
      }
    });

    it('should skip auto-tokenize when mode=regex', async () => {
      // Multi-word regex: should NOT be tokenized, should be used as-is
      const result = await handleInstructionsSearch({
        keywords: ['JavaScript hooks'],
        mode: 'regex'
      });
      // "JavaScript hooks" as a regex matches "JavaScript" then " hooks" — depends on content
      // Key assertion: autoTokenized should NOT be true
      expect(result.autoTokenized).toBeUndefined();
    });

    it('should include mode in response query object', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['test'],
        mode: 'regex'
      });
      expect(result.query).toHaveProperty('mode', 'regex');
    });

    it('should suggest regex in hints when keyword search returns zero results', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['nonexistentkeyword123'],
        mode: 'keyword'
      });
      expect(result.hints).toBeDefined();
      expect(result.hints!.some(h => h.toLowerCase().includes('regex'))).toBe(true);
    });
  });
});
