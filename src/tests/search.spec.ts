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
import { CONTENT_TYPES, type ContentType, type InstructionEntry } from '../models/instruction';

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
        // Schema now uses anyOf for keywords/searchString/fields; verify it references keywords
        const schema = err.data.schema as any;
        const mentionsKeywords = schema.required?.includes('keywords') ||
          (Array.isArray(schema.anyOf) && schema.anyOf.some((s: any) => s.required?.includes('keywords')));
        expect(mentionsKeywords).toBe(true);
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

  describe('contentType filtering', () => {
    // Diverse contentType entries added/removed per-test to avoid breaking existing assertions.
    const ctEntries: InstructionEntry[] = [
      {
        id: 'ct-integration-figma', title: 'Figma Plugin Connector Setup',
        body: 'Enterprise connector for Figma plugin design system synchronization.',
        priority: 20, audience: 'all', requirement: 'optional',
        categories: ['figma', 'connector'], contentType: 'integration',
        sourceHash: 'ct01', schemaVersion: '1',
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
      },
      {
        id: 'ct-integration-datadog', title: 'Datadog Metrics Connector',
        body: 'Datadog observability connector for dashboard telemetry export.',
        priority: 25, audience: 'all', requirement: 'optional',
        categories: ['datadog', 'connector'], contentType: 'integration',
        sourceHash: 'ct02', schemaVersion: '1',
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
      },
      {
        id: 'ct-agent-persona', title: 'Autonomous Agent Persona Definition',
        body: 'Enterprise persona definition for autonomous agent task delegation.',
        priority: 15, audience: 'all', requirement: 'recommended',
        categories: ['persona', 'autonomous'], contentType: 'agent',
        sourceHash: 'ct03', schemaVersion: '1',
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
      },
      {
        id: 'ct-skill-modular', title: 'Modular Capability Registration',
        body: 'Register modular capabilities for agent skill composition.',
        priority: 30, audience: 'all', requirement: 'optional',
        categories: ['modular', 'capability'], contentType: 'skill',
        sourceHash: 'ct04', schemaVersion: '1',
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
      },
      {
        id: 'ct-prompt-summarization', title: 'Summarization Prompt Patterns',
        body: 'Prompt patterns for extractive and abstractive summarization tasks.',
        priority: 35, audience: 'all', requirement: 'optional',
        categories: ['summarization', 'extraction'], contentType: 'prompt',
        sourceHash: 'ct05', schemaVersion: '1',
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
      },
      {
        id: 'ct-workflow-choreography', title: 'Choreography Orchestration Runbook',
        body: 'Multi-step choreography for orchestrating distributed agent tasks.',
        priority: 40, audience: 'all', requirement: 'optional',
        categories: ['choreography', 'orchestrate'], contentType: 'workflow',
        sourceHash: 'ct06', schemaVersion: '1',
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
      },
      {
        id: 'ct-knowledge-almanac', title: 'Encyclopedia Almanac Reference',
        body: 'Reference almanac with encyclopedia entries for domain knowledge.',
        priority: 45, audience: 'all', requirement: 'optional',
        categories: ['encyclopedia', 'almanac'], contentType: 'knowledge',
        sourceHash: 'ct07', schemaVersion: '1',
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
      },
      {
        id: 'ct-template-starter', title: 'Boilerplate Starter Kit',
        body: 'Enterprise starter kit boilerplate for rapid project bootstrapping.',
        priority: 50, audience: 'all', requirement: 'optional',
        categories: ['boilerplate', 'starter'], contentType: 'template',
        sourceHash: 'ct08', schemaVersion: '1',
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
      },
    ];

    beforeEach(() => {
      mockInstructions.push(...ctEntries);
    });

    afterEach(() => {
      mockInstructions.splice(mockInstructions.length - ctEntries.length, ctEntries.length);
    });

    it('CF-01: contentType=integration returns only integration entries in keyword mode', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['connector'],
        contentType: 'integration'
      });
      expect(result.results.length).toBe(2);
      expect(result.results.every(r => r.instructionId.startsWith('ct-integration-'))).toBe(true);
    });

    it('CF-02: contentType filter is passed through in semantic mode', async () => {
      mockSemanticEnabled = true;
      try {
        const result = await handleInstructionsSearch({
          keywords: ['figma'],
          contentType: 'integration'
        });
        expect(result.query.mode).toBe('semantic');
        expect(result.query.contentType).toBe('integration');
      } finally {
        mockSemanticEnabled = false;
      }
    });

    it('CF-03: contentType=agent excludes instruction and integration entries', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['enterprise'],
        contentType: 'agent'
      });
      expect(result.results.length).toBe(1);
      expect(result.results[0].instructionId).toBe('ct-agent-persona');
    });

    it('CF-04: no contentType filter returns entries from multiple types', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['enterprise']
      });
      // 'enterprise' appears in ct-integration-figma, ct-agent-persona, ct-template-starter
      expect(result.results.length).toBe(3);
      const ids = result.results.map(r => r.instructionId);
      expect(ids).toContain('ct-integration-figma');
      expect(ids).toContain('ct-agent-persona');
      expect(ids).toContain('ct-template-starter');
    });

    it('CF-05: invalid contentType value throws validation error', async () => {
      await expect(handleInstructionsSearch({
        keywords: ['test'],
        contentType: 'nonexistent' as any
      })).rejects.toThrow('contentType must be one of');
    });

    it('CF-06: contentType not in enum rejects with semantic error', async () => {
      try {
        await handleInstructionsSearch({
          keywords: ['test'],
          contentType: 'invalid-type' as any
        });
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(isSemanticError(e)).toBe(true);
        const err = e as { code: number; message: string };
        expect(err.code).toBe(-32602);
        expect(err.message).toContain('contentType must be one of');
      }
    });

    it('CF-07: contentType filter combined with keywords narrows correctly', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['connector'],
        contentType: 'integration'
      });
      expect(result.results.length).toBe(2);
      expect(result.query.contentType).toBe('integration');
    });

    it('CF-08: contentType filter with no keyword matches returns empty', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['zzzznonexistent'],
        contentType: 'integration'
      });
      expect(result.results.length).toBe(0);
      expect(result.totalMatches).toBe(0);
    });

    it('CF-09: contentType is case-sensitive (exact enum match required)', async () => {
      await expect(handleInstructionsSearch({
        keywords: ['test'],
        contentType: 'Integration' as any
      })).rejects.toThrow('contentType must be one of');
    });

    it('CF-10: contentType as number/object/array is rejected', async () => {
      await expect(handleInstructionsSearch({
        keywords: ['test'],
        contentType: 123 as any
      })).rejects.toThrow('contentType must be a string');

      await expect(handleInstructionsSearch({
        keywords: ['test'],
        contentType: { type: 'integration' } as any
      })).rejects.toThrow('contentType must be a string');

      await expect(handleInstructionsSearch({
        keywords: ['test'],
        contentType: ['integration'] as any
      })).rejects.toThrow('contentType must be a string');
    });

    it('CF-11: contentType=undefined (omitted) behaves as no filter', async () => {
      const withUndefined = await handleInstructionsSearch({
        keywords: ['enterprise'],
        contentType: undefined
      });
      const withoutProp = await handleInstructionsSearch({
        keywords: ['enterprise']
      });
      expect(withUndefined.results.length).toBe(withoutProp.results.length);
      expect(withUndefined.query.contentType).toBeUndefined();
    });

    it('CF-12: each of the 8 contentType enum values returns correct subset', async () => {
      const uniqueKeywords: Record<ContentType, string> = {
        agent: 'persona',
        skill: 'modular',
        instruction: 'JavaScript', // matches existing instruction entries
        prompt: 'summarization',
        workflow: 'choreography',
        knowledge: 'almanac',
        template: 'boilerplate',
        integration: 'figma',
      };

      for (const ct of CONTENT_TYPES) {
        const result = await handleInstructionsSearch({
          keywords: [uniqueKeywords[ct]],
          contentType: ct
        });
        expect(result.results.length, `contentType=${ct} should return results`).toBeGreaterThan(0);
        if (ct === 'instruction') {
          expect(result.results[0].instructionId).toBe('test-001');
        } else {
          expect(
            result.results.every(r => r.instructionId.startsWith('ct-')),
            `contentType=${ct} should only return ct- prefixed entries`
          ).toBe(true);
        }
      }
    });
  });

  describe('ranking determinism', () => {
    // Ranking entries with distinct hit patterns for pairwise assertions.
    const rankEntries: InstructionEntry[] = [
      {
        id: 'rank-exact-id', title: 'Unrelated Title',
        body: 'Unrelated body content for ranking tests.',
        priority: 50, audience: 'all', requirement: 'optional',
        categories: ['ranking'], contentType: 'instruction',
        sourceHash: 'rk01', schemaVersion: '1',
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
      },
      {
        id: 'rank-partial', title: 'Rank Exact ID in Title',
        body: 'This entry mentions rank-exact-id only in title.',
        priority: 50, audience: 'all', requirement: 'optional',
        categories: ['ranking'], contentType: 'instruction',
        sourceHash: 'rk02', schemaVersion: '1',
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
      },
      {
        id: 'rank-body-only', title: 'Unrelated Title Two',
        body: 'This entry mentions rank-exact-id only in the body text for pairwise comparison.',
        priority: 50, audience: 'all', requirement: 'optional',
        categories: ['ranking'], contentType: 'instruction',
        sourceHash: 'rk03', schemaVersion: '1',
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
      },
      {
        id: 'rank-multi-hit', title: 'Zenith Ranking Entry',
        body: 'Zenith is a great approach for zenith-related ranking tests. Zenith zenith zenith.',
        priority: 50, audience: 'all', requirement: 'optional',
        categories: ['zenith'], contentType: 'instruction',
        sourceHash: 'rk04', schemaVersion: '1',
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
      },
      {
        id: 'rank-single-hit', title: 'Unrelated Title Three',
        body: 'This entry mentions zenith exactly once for comparison.',
        priority: 50, audience: 'all', requirement: 'optional',
        categories: ['ranking'], contentType: 'instruction',
        sourceHash: 'rk05', schemaVersion: '1',
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
      },
      {
        id: 'rank-tiebreak-aaa', title: 'Tiebreak Entry Alpha',
        body: 'Quasar tiebreak verification entry alpha.',
        priority: 50, audience: 'all', requirement: 'optional',
        categories: ['quasar'], contentType: 'instruction',
        sourceHash: 'rk06', schemaVersion: '1',
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
      },
      {
        id: 'rank-tiebreak-zzz', title: 'Tiebreak Entry Zulu',
        body: 'Quasar tiebreak verification entry zulu.',
        priority: 50, audience: 'all', requirement: 'optional',
        categories: ['quasar'], contentType: 'instruction',
        sourceHash: 'rk07', schemaVersion: '1',
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z'
      },
    ];

    beforeEach(() => {
      mockInstructions.push(...rankEntries);
    });

    afterEach(() => {
      mockInstructions.splice(mockInstructions.length - rankEntries.length, rankEntries.length);
    });

    it('RK-01: exact id match outranks partial title match (pairwise)', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['rank-exact-id']
      });
      const ids = result.results.map(r => r.instructionId);
      const exactIdx = ids.indexOf('rank-exact-id');
      const titleIdx = ids.indexOf('rank-partial');
      expect(exactIdx, 'exact id match should appear in results').toBeGreaterThanOrEqual(0);
      expect(titleIdx, 'title match should appear in results').toBeGreaterThanOrEqual(0);
      expect(exactIdx, 'exact id match should outrank title match').toBeLessThan(titleIdx);
    });

    it('RK-02: id-prefix match outranks body-only match (pairwise)', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['rank-exact-id']
      });
      const ids = result.results.map(r => r.instructionId);
      const idIdx = ids.indexOf('rank-exact-id');
      const bodyIdx = ids.indexOf('rank-body-only');
      expect(idIdx, 'id match should appear').toBeGreaterThanOrEqual(0);
      expect(bodyIdx, 'body match should appear').toBeGreaterThanOrEqual(0);
      expect(idIdx, 'id match outranks body-only').toBeLessThan(bodyIdx);
    });

    it('RK-03: title match outranks body-only match (pairwise)', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['rank-exact-id']
      });
      const ids = result.results.map(r => r.instructionId);
      const titleIdx = ids.indexOf('rank-partial');
      const bodyIdx = ids.indexOf('rank-body-only');
      expect(titleIdx, 'title match should appear').toBeGreaterThanOrEqual(0);
      expect(bodyIdx, 'body match should appear').toBeGreaterThanOrEqual(0);
      expect(titleIdx, 'title match outranks body-only').toBeLessThan(bodyIdx);
    });

    it('RK-04: multiple keyword hits outrank single hit (pairwise)', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['zenith']
      });
      const ids = result.results.map(r => r.instructionId);
      const multiIdx = ids.indexOf('rank-multi-hit');
      const singleIdx = ids.indexOf('rank-single-hit');
      expect(multiIdx, 'multi-hit entry should appear').toBeGreaterThanOrEqual(0);
      expect(singleIdx, 'single-hit entry should appear').toBeGreaterThanOrEqual(0);
      expect(multiIdx, 'multi-hit outranks single-hit').toBeLessThan(singleIdx);
    });

    it('RK-05: same query twice returns identical ordering (keyword mode)', async () => {
      const result1 = await handleInstructionsSearch({ keywords: ['rank-exact-id'] });
      const result2 = await handleInstructionsSearch({ keywords: ['rank-exact-id'] });
      const ids1 = result1.results.map(r => r.instructionId);
      const ids2 = result2.results.map(r => r.instructionId);
      expect(ids1).toEqual(ids2);
    });

    it('RK-06: same query twice returns identical ordering (semantic mode)', async () => {
      mockSemanticEnabled = true;
      try {
        const result1 = await handleInstructionsSearch({ keywords: ['rank-exact-id'] });
        const result2 = await handleInstructionsSearch({ keywords: ['rank-exact-id'] });
        const ids1 = result1.results.map(r => r.instructionId);
        const ids2 = result2.results.map(r => r.instructionId);
        expect(ids1).toEqual(ids2);
      } finally {
        mockSemanticEnabled = false;
      }
    });

    it('RK-07: same-score entries have deterministic tie-break (by id)', async () => {
      // Both rank-tiebreak-aaa and rank-tiebreak-zzz have 'quasar' in body with
      // same structure and priority — should be sorted deterministically.
      const result = await handleInstructionsSearch({ keywords: ['quasar'] });
      const ids = result.results.map(r => r.instructionId);
      const aaaIdx = ids.indexOf('rank-tiebreak-aaa');
      const zzzIdx = ids.indexOf('rank-tiebreak-zzz');
      expect(aaaIdx, 'aaa entry should appear').toBeGreaterThanOrEqual(0);
      expect(zzzIdx, 'zzz entry should appear').toBeGreaterThanOrEqual(0);
      // Deterministic: aaa < zzz alphabetically, so aaa should come first
      expect(aaaIdx, 'aaa should come before zzz in deterministic tie-break').toBeLessThan(zzzIdx);
    });

    it('RK-08: query with no matches returns empty, not error', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['xyzzy9999nonexistent']
      });
      expect(result.results).toEqual([]);
      expect(result.totalMatches).toBe(0);
    });

    it('RK-09: single-character keyword returns reasonable results, not crash', async () => {
      const result = await handleInstructionsSearch({ keywords: ['a'] });
      expect(Array.isArray(result.results)).toBe(true);
      // Should not throw — may or may not have results depending on indexing
    });

    it('RK-10: keywords with special regex chars do not break keyword mode', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['rank-exact-id[test](foo)'],
        mode: 'keyword'
      });
      // Should not throw, just return fewer/no results
      expect(Array.isArray(result.results)).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Field-level query tests (#343 Item 3) — RED phase
  //
  // These tests target the `fields` structural predicate object and
  // `searchString` ergonomic phrase input added by the architecture
  // design. They are expected to FAIL until the handler is updated.
  // ────────────────────────────────────────────────────────────────────
  describe('field-level query (#343 Item 3)', () => {
    // Diverse mock entries with varied field values for structural filtering.
    const fieldEntries: InstructionEntry[] = [
      {
        id: 'fl-mcp-server-config-stdio', title: 'MCP Server STDIO Config',
        body: 'Configure MCP servers with STDIO transport for local powershell usage.',
        priority: 3, audience: 'all', requirement: 'mandatory',
        categories: ['mcp', 'configuration'], contentType: 'integration',
        owner: 'jagilber', status: 'approved', priorityTier: 'P1',
        classification: 'internal',
        sourceHash: 'fl01', schemaVersion: '1',
        createdAt: '2026-04-15T00:00:00Z', updatedAt: '2026-05-05T12:00:00Z'
      },
      {
        id: 'fl-mcp-server-config-sse', title: 'MCP Server SSE Config',
        body: 'Configure MCP servers with SSE transport for remote powershell usage.',
        priority: 5, audience: 'all', requirement: 'recommended',
        categories: ['mcp', 'configuration', 'networking'], contentType: 'integration',
        owner: 'jagilber', status: 'approved', priorityTier: 'P2',
        classification: 'internal',
        sourceHash: 'fl02', schemaVersion: '1',
        createdAt: '2026-04-20T00:00:00Z', updatedAt: '2026-05-08T12:00:00Z'
      },
      {
        id: 'fl-agent-reviewer', title: 'Code Reviewer Agent',
        body: 'Agent definition for automated code review persona.',
        priority: 10, audience: 'group', requirement: 'optional',
        categories: ['agents', 'code-review'], contentType: 'agent',
        owner: 'team-platform', status: 'review', priorityTier: 'P2',
        classification: 'public',
        sourceHash: 'fl03', schemaVersion: '1',
        createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-04-25T00:00:00Z'
      },
      {
        id: 'fl-template-scaffold', title: 'Project Scaffold Template',
        body: 'Starter template for bootstrapping new repositories.',
        priority: 20, audience: 'all', requirement: 'recommended',
        categories: ['templates', 'bootstrap'], contentType: 'template',
        owner: 'team-dx', status: 'approved', priorityTier: 'P3',
        classification: 'public',
        sourceHash: 'fl04', schemaVersion: '1',
        createdAt: '2026-01-10T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z'
      },
      {
        id: 'fl-deprecated-runbook', title: 'Legacy Runbook',
        body: 'Deprecated operational runbook superseded by new workflow.',
        priority: 80, audience: 'all', requirement: 'deprecated',
        categories: ['deprecated', 'operations'], contentType: 'workflow',
        status: 'deprecated', priorityTier: 'P4',
        classification: 'restricted',
        sourceHash: 'fl05', schemaVersion: '1',
        createdAt: '2025-06-01T00:00:00Z', updatedAt: '2025-12-15T00:00:00Z'
      },
      {
        id: 'fl-knowledge-api-ref', title: 'API Reference Guide',
        body: 'Knowledge base entry covering REST API reference documentation.',
        priority: 15, audience: 'all', requirement: 'recommended',
        categories: ['api', 'documentation', 'mcp'], contentType: 'knowledge',
        owner: 'jagilber', status: 'approved', priorityTier: 'P2',
        classification: 'internal',
        sourceHash: 'fl06', schemaVersion: '1',
        createdAt: '2026-02-14T00:00:00Z', updatedAt: '2026-05-03T00:00:00Z'
      },
    ];

    beforeEach(() => {
      mockInstructions.push(...fieldEntries);
    });

    afterEach(() => {
      mockInstructions.splice(mockInstructions.length - fieldEntries.length, fieldEntries.length);
    });

    // ── FL-01..FL-08: Field filter basics ──────────────────────────────

    it('FL-01: fields.contentType array filters by OR (no keywords needed)', async () => {
      const result = await handleInstructionsSearch({
        fields: { contentType: ['integration', 'template'] }
      } as any);
      expect(result.results.length).toBeGreaterThanOrEqual(3);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('fl-mcp-server-config-stdio');
      expect(ids).toContain('fl-mcp-server-config-sse');
      expect(ids).toContain('fl-template-scaffold');
      // Should NOT contain agent or workflow entries
      expect(ids).not.toContain('fl-agent-reviewer');
      expect(ids).not.toContain('fl-deprecated-runbook');
    });

    it('FL-02: fields.owner scalar exact match', async () => {
      const result = await handleInstructionsSearch({
        fields: { owner: 'jagilber' }
      } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('fl-mcp-server-config-stdio');
      expect(ids).toContain('fl-mcp-server-config-sse');
      expect(ids).toContain('fl-knowledge-api-ref');
      // Should not contain entries with different or missing owner
      expect(ids).not.toContain('fl-agent-reviewer');
      expect(ids).not.toContain('fl-deprecated-runbook');
    });

    it('FL-03: fields.status enum array OR', async () => {
      const result = await handleInstructionsSearch({
        fields: { status: ['approved', 'review'] }
      } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('fl-mcp-server-config-stdio');
      expect(ids).toContain('fl-agent-reviewer');
      // deprecated status excluded
      expect(ids).not.toContain('fl-deprecated-runbook');
    });

    it('FL-04: fields.priorityTier array OR', async () => {
      const result = await handleInstructionsSearch({
        fields: { priorityTier: ['P1', 'P2'] }
      } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('fl-mcp-server-config-stdio');
      expect(ids).toContain('fl-mcp-server-config-sse');
      expect(ids).toContain('fl-agent-reviewer');
      expect(ids).toContain('fl-knowledge-api-ref');
      expect(ids).not.toContain('fl-template-scaffold');
      expect(ids).not.toContain('fl-deprecated-runbook');
    });

    it('FL-05: fields.classification scalar exact match', async () => {
      const result = await handleInstructionsSearch({
        fields: { classification: 'internal' }
      } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('fl-mcp-server-config-stdio');
      expect(ids).toContain('fl-mcp-server-config-sse');
      expect(ids).toContain('fl-knowledge-api-ref');
      expect(ids).not.toContain('fl-agent-reviewer');
      expect(ids).not.toContain('fl-deprecated-runbook');
    });

    it('FL-06: fields.categoriesAny contains-any match', async () => {
      const result = await handleInstructionsSearch({
        fields: { categoriesAny: ['mcp', 'code-review'] }
      } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('fl-mcp-server-config-stdio');
      expect(ids).toContain('fl-mcp-server-config-sse');
      expect(ids).toContain('fl-agent-reviewer');
      expect(ids).toContain('fl-knowledge-api-ref');
      expect(ids).not.toContain('fl-template-scaffold');
    });

    it('FL-07: fields.categoriesAll contains-all match', async () => {
      const result = await handleInstructionsSearch({
        fields: { categoriesAll: ['mcp', 'configuration'] }
      } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('fl-mcp-server-config-stdio');
      expect(ids).toContain('fl-mcp-server-config-sse');
      // knowledge entry has mcp but NOT configuration
      expect(ids).not.toContain('fl-knowledge-api-ref');
    });

    it('FL-08: fields.categoriesNone excludes entries with specified categories', async () => {
      const result = await handleInstructionsSearch({
        fields: { categoriesNone: ['deprecated'] }
      } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).not.toContain('fl-deprecated-runbook');
      // Other entries should still be present
      expect(ids).toContain('fl-mcp-server-config-stdio');
    });

    // ── FL-09..FL-12: Virtual operators ────────────────────────────────

    it('FL-09: fields.idPrefix filters by id prefix', async () => {
      const result = await handleInstructionsSearch({
        fields: { idPrefix: 'fl-mcp-server-config-' }
      } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('fl-mcp-server-config-stdio');
      expect(ids).toContain('fl-mcp-server-config-sse');
      expect(ids).toHaveLength(2);
    });

    it('FL-10: fields.idRegex filters by regex pattern', async () => {
      const result = await handleInstructionsSearch({
        fields: { idRegex: '^fl-mcp-server-config-.*' }
      } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('fl-mcp-server-config-stdio');
      expect(ids).toContain('fl-mcp-server-config-sse');
      expect(ids).toHaveLength(2);
    });

    it('FL-11: fields.updatedAfter and updatedBefore define inclusive date range', async () => {
      const result = await handleInstructionsSearch({
        fields: {
          updatedAfter: '2026-05-01T00:00:00Z',
          updatedBefore: '2026-05-10T00:00:00Z'
        }
      } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      // updatedAt within range: stdio (May 5), sse (May 8), template (May 1 exact boundary), knowledge (May 3)
      expect(ids).toContain('fl-mcp-server-config-stdio');
      expect(ids).toContain('fl-mcp-server-config-sse');
      expect(ids).toContain('fl-template-scaffold');
      expect(ids).toContain('fl-knowledge-api-ref');
      // Outside range: agent (Apr 25), deprecated (Dec 15 2025)
      expect(ids).not.toContain('fl-agent-reviewer');
      expect(ids).not.toContain('fl-deprecated-runbook');
    });

    it('FL-12: fields.priorityMin and priorityMax define inclusive numeric range', async () => {
      const result = await handleInstructionsSearch({
        fields: { priorityMin: 1, priorityMax: 10 }
      } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      // priority 3, 5, 10 are in range
      expect(ids).toContain('fl-mcp-server-config-stdio');
      expect(ids).toContain('fl-mcp-server-config-sse');
      expect(ids).toContain('fl-agent-reviewer');
      // priority 15, 20, 80 are out of range
      expect(ids).not.toContain('fl-knowledge-api-ref');
      expect(ids).not.toContain('fl-template-scaffold');
      expect(ids).not.toContain('fl-deprecated-runbook');
    });

    // ── FL-13..FL-17: Validation ───────────────────────────────────────

    it('FL-13: unknown field name in fields object throws validation error', async () => {
      await expect(handleInstructionsSearch({
        fields: { nonExistentField: 'value' }
      } as any)).rejects.toThrow();
    });

    it('FL-14: fields.idRegex with ReDoS pattern is rejected', async () => {
      await expect(handleInstructionsSearch({
        fields: { idRegex: '(a+)+$' }
      } as any)).rejects.toThrow();
    });

    it('FL-15: empty fields object is rejected', async () => {
      await expect(handleInstructionsSearch({
        fields: {}
      } as any)).rejects.toThrow();
    });

    it('FL-16: fields.contentType with invalid enum value is rejected', async () => {
      await expect(handleInstructionsSearch({
        fields: { contentType: 'nonexistent' }
      } as any)).rejects.toThrow();
    });

    it('FL-17: inverted numeric range (min > max) is rejected', async () => {
      await expect(handleInstructionsSearch({
        fields: { priorityMin: 10, priorityMax: 1 }
      } as any)).rejects.toThrow();
    });

    it('FL-18: empty array value in fields is rejected', async () => {
      await expect(handleInstructionsSearch({
        fields: { status: [] }
      } as any)).rejects.toThrow();
    });

    // ── FL-19..FL-24: Combination & backward compat ────────────────────

    it('FL-19: searchString + fields combined narrows results', async () => {
      const result = await handleInstructionsSearch({
        searchString: 'powershell',
        fields: { contentType: 'integration' }
      } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      // Only integration entries mentioning powershell
      expect(result.results.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect(id).toMatch(/^fl-mcp-server-config-/);
      }
    });

    it('FL-20: multiple fields AND together', async () => {
      const result = await handleInstructionsSearch({
        fields: { contentType: 'integration', status: 'approved' }
      } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('fl-mcp-server-config-stdio');
      expect(ids).toContain('fl-mcp-server-config-sse');
      // agent-reviewer is integration=no, status=review
      expect(ids).not.toContain('fl-agent-reviewer');
    });

    it('FL-21: existing keywords-only query still works (backward compat)', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['JavaScript']
      });
      expect(result.results.length).toBe(1);
      expect(result.results[0].instructionId).toBe('test-001');
    });

    it('FL-22: top-level contentType still works as deprecated alias', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['config'],
        contentType: 'integration'
      });
      expect(result.query.contentType).toBe('integration');
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('FL-23: top-level contentType conflicts with fields.contentType → error', async () => {
      await expect(handleInstructionsSearch({
        keywords: ['config'],
        contentType: 'integration',
        fields: { contentType: 'template' }
      } as any)).rejects.toThrow();
    });

    it('FL-24: top-level contentType and fields.contentType equal → accepted', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['config'],
        contentType: 'integration',
        fields: { contentType: 'integration' }
      } as any);
      expect(result.results.length).toBeGreaterThan(0);
    });

    // ── FL-25..FL-30: Edge cases ───────────────────────────────────────

    it('FL-25: keywords and searchString are mutually exclusive → error', async () => {
      await expect(handleInstructionsSearch({
        keywords: ['test'],
        searchString: 'test phrase'
      } as any)).rejects.toThrow();
    });

    it('FL-26: no keywords, no searchString, no fields → error', async () => {
      await expect(handleInstructionsSearch({
      } as any)).rejects.toThrow();
    });

    it('FL-27: fields.categoriesAny works independently of includeCategories flag', async () => {
      const result = await handleInstructionsSearch({
        fields: { categoriesAny: ['mcp'] },
        includeCategories: false
      } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('fl-mcp-server-config-stdio');
      expect(ids).toContain('fl-mcp-server-config-sse');
      expect(ids).toContain('fl-knowledge-api-ref');
    });

    it('FL-28: searchString without keywords works as pure phrase query', async () => {
      const result = await handleInstructionsSearch({
        searchString: 'MCP Server'
      } as any);
      expect(result.results.length).toBeGreaterThan(0);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('fl-mcp-server-config-stdio');
    });

    it('FL-29: pure structural query returns deterministic ordering', async () => {
      const result1 = await handleInstructionsSearch({
        fields: { contentType: 'integration' }
      } as any);
      const result2 = await handleInstructionsSearch({
        fields: { contentType: 'integration' }
      } as any);
      const ids1 = result1.results.map((r: any) => r.instructionId);
      const ids2 = result2.results.map((r: any) => r.instructionId);
      expect(ids1).toEqual(ids2);
      expect(ids1.length).toBeGreaterThan(0);
    });

    it('FL-30: entry missing optional field does not match that field filter', async () => {
      // fl-deprecated-runbook has no owner set
      const result = await handleInstructionsSearch({
        fields: { owner: 'team-dx' }
      } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('fl-template-scaffold');
      expect(ids).not.toContain('fl-deprecated-runbook');
    });

    it('FL-31: high-text-score entry excluded by field filter does not appear', async () => {
      // fl-deprecated-runbook mentions "runbook" but is contentType=workflow
      const result = await handleInstructionsSearch({
        searchString: 'runbook',
        fields: { contentType: 'integration' }
      } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).not.toContain('fl-deprecated-runbook');
    });

    it('FL-32: date boundary — exact updatedAfter timestamp is inclusive', async () => {
      // fl-template-scaffold updatedAt is exactly '2026-05-01T00:00:00Z'
      const result = await handleInstructionsSearch({
        fields: { updatedAfter: '2026-05-01T00:00:00Z' }
      } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('fl-template-scaffold');
    });

    it('FL-33: numeric boundary — exact priorityMin value is inclusive', async () => {
      // fl-mcp-server-config-stdio has priority=3
      const result = await handleInstructionsSearch({
        fields: { priorityMin: 3, priorityMax: 3 }
      } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('fl-mcp-server-config-stdio');
    });

    it('FL-34: response echoes fields and searchString in query metadata', async () => {
      const result = await handleInstructionsSearch({
        searchString: 'powershell',
        fields: { contentType: 'integration' }
      } as any);
      expect((result.query as any).searchString).toBe('powershell');
      expect((result.query as any).fields).toBeDefined();
      expect((result.query as any).fields.contentType).toBe('integration');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // FL-35..FL-60: Full schema field / enum / virtual-operator coverage (#348)
  //
  // Locks the runtime `fields` filter surface to the canonical schema,
  // exercising every enum value, every numeric/date virtual operator, the
  // teamIds array operators, and the remaining canonical field predicates
  // (audience, requirement, workspaceId, version, supersedes) that the
  // FL-01..FL-34 block did not cover.
  // ────────────────────────────────────────────────────────────────────
  describe('field-level query — full schema coverage (#348)', () => {
    // Seed entries chosen so every enum value, every operator boundary, and
    // every previously-uncovered canonical predicate has at least one
    // positive matching row and at least one non-matching row.
    const covEntries: InstructionEntry[] = [
      {
        // individual audience, critical requirement, instruction contentType,
        // draft status, P1 tier, public classification.
        // High usageCount, low riskScore, short review interval.
        // Dates clustered in early 2026.
        id: 'cov-individual-instruction-001',
        title: 'Coverage individual instruction',
        body: 'Coverage seed entry for FL-35..FL-60 enum and operator sweep.',
        priority: 4,
        audience: 'individual',
        requirement: 'critical',
        categories: ['coverage', 'enum-sweep'],
        contentType: 'instruction',
        owner: 'cov-owner-1',
        status: 'draft',
        priorityTier: 'P1',
        classification: 'public',
        sourceHash: 'cov01',
        schemaVersion: '1',
        teamIds: ['team-alpha', 'team-beta'],
        usageCount: 50,
        riskScore: 1,
        reviewIntervalDays: 30,
        workspaceId: 'ws-alpha',
        version: '1.0.0',
        supersedes: 'cov-legacy-old-001',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-15T00:00:00Z',
        firstSeenTs: '2026-01-02T00:00:00Z',
        lastUsedAt: '2026-01-20T00:00:00Z',
        lastReviewedAt: '2026-01-10T00:00:00Z',
        nextReviewDue: '2026-02-10T00:00:00Z',
      },
      {
        // group audience, mandatory requirement, skill contentType,
        // approved status, P2 tier, internal classification.
        // Medium usageCount, medium riskScore, medium review interval.
        id: 'cov-group-skill-001',
        title: 'Coverage group skill',
        body: 'Coverage seed entry for skill contentType and teamIds operators.',
        priority: 8,
        audience: 'group',
        requirement: 'mandatory',
        categories: ['coverage', 'skills'],
        contentType: 'skill',
        owner: 'cov-owner-2',
        status: 'approved',
        priorityTier: 'P2',
        classification: 'internal',
        sourceHash: 'cov02',
        schemaVersion: '1',
        teamIds: ['team-alpha'],
        usageCount: 5,
        riskScore: 5,
        reviewIntervalDays: 90,
        workspaceId: 'ws-beta',
        version: '2.1.0',
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-15T00:00:00Z',
        firstSeenTs: '2026-02-02T00:00:00Z',
        lastUsedAt: '2026-02-20T00:00:00Z',
        lastReviewedAt: '2026-02-10T00:00:00Z',
        nextReviewDue: '2026-05-10T00:00:00Z',
      },
      {
        // all audience, recommended requirement, prompt contentType,
        // review status, P3 tier, internal classification.
        // Zero usage, high risk, long review interval.
        id: 'cov-all-prompt-001',
        title: 'Coverage all prompt',
        body: 'Coverage seed entry for prompt contentType and numeric range operators.',
        priority: 20,
        audience: 'all',
        requirement: 'recommended',
        categories: ['coverage', 'prompts'],
        contentType: 'prompt',
        owner: 'cov-owner-3',
        status: 'review',
        priorityTier: 'P3',
        classification: 'internal',
        sourceHash: 'cov03',
        schemaVersion: '1',
        teamIds: ['team-gamma'],
        usageCount: 0,
        riskScore: 9,
        reviewIntervalDays: 180,
        workspaceId: 'ws-alpha',
        version: '3.0.0-rc.1',
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-15T00:00:00Z',
        firstSeenTs: '2026-03-02T00:00:00Z',
        lastUsedAt: '2026-03-20T00:00:00Z',
        lastReviewedAt: '2026-03-10T00:00:00Z',
        nextReviewDue: '2026-09-10T00:00:00Z',
      },
      {
        // all audience, optional requirement, workflow contentType,
        // deprecated status (already covered for status, but extra workflow
        // entry helps disambiguate FL-37 requirement=optional matches).
        // Archived date present for archivedAfter/Before coverage.
        id: 'cov-all-workflow-archived-001',
        title: 'Coverage archived workflow',
        body: 'Coverage seed entry for archivedAt operator.',
        priority: 60,
        audience: 'all',
        requirement: 'optional',
        categories: ['coverage', 'archived'],
        contentType: 'workflow',
        owner: 'cov-owner-4',
        status: 'deprecated',
        priorityTier: 'P4',
        classification: 'restricted',
        sourceHash: 'cov04',
        schemaVersion: '1',
        teamIds: ['team-beta', 'team-gamma'],
        usageCount: 100,
        riskScore: 3,
        reviewIntervalDays: 365,
        workspaceId: 'ws-gamma',
        version: '0.9.0',
        archivedAt: '2025-12-01T00:00:00Z',
        createdAt: '2025-06-01T00:00:00Z',
        updatedAt: '2025-11-30T00:00:00Z',
        firstSeenTs: '2025-06-02T00:00:00Z',
        lastUsedAt: '2025-11-25T00:00:00Z',
        lastReviewedAt: '2025-11-15T00:00:00Z',
        nextReviewDue: '2026-11-15T00:00:00Z',
      },
    ];

    beforeEach(() => {
      mockInstructions.push(...covEntries);
    });

    afterEach(() => {
      mockInstructions.splice(mockInstructions.length - covEntries.length, covEntries.length);
    });

    // ── FL-35..FL-39: audience + requirement field predicates ──────────

    it('FL-35: fields.audience=individual matches only individual entries', async () => {
      const result = await handleInstructionsSearch({ fields: { audience: 'individual' } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-individual-instruction-001');
      expect(ids).not.toContain('cov-group-skill-001');
      expect(ids).not.toContain('cov-all-prompt-001');
    });

    it('FL-36: fields.audience array OR matches multiple audience values', async () => {
      const result = await handleInstructionsSearch({ fields: { audience: ['individual', 'group'] } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-individual-instruction-001');
      expect(ids).toContain('cov-group-skill-001');
      expect(ids).not.toContain('cov-all-prompt-001');
    });

    it('FL-37: fields.requirement=critical matches only critical entries', async () => {
      const result = await handleInstructionsSearch({ fields: { requirement: 'critical' } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-individual-instruction-001');
      expect(ids).not.toContain('cov-group-skill-001');
    });

    it('FL-38: fields.requirement array OR covers mandatory+recommended', async () => {
      const result = await handleInstructionsSearch({ fields: { requirement: ['mandatory', 'recommended'] } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-group-skill-001');
      expect(ids).toContain('cov-all-prompt-001');
      expect(ids).not.toContain('cov-individual-instruction-001');
      expect(ids).not.toContain('cov-all-workflow-archived-001');
    });

    it('FL-39: fields.audience with invalid enum value is rejected', async () => {
      await expect(handleInstructionsSearch({ fields: { audience: 'team' } } as any)).rejects.toThrow();
    });

    // ── FL-40..FL-43: Enum-value sweep (contentType, status, priorityTier, classification) ──

    it('FL-40: fields.contentType covers instruction, skill, prompt (gap fillers)', async () => {
      const r1 = await handleInstructionsSearch({ fields: { contentType: 'instruction' } } as any);
      expect(r1.results.map((r: any) => r.instructionId)).toContain('cov-individual-instruction-001');

      const r2 = await handleInstructionsSearch({ fields: { contentType: 'skill' } } as any);
      const r2ids = r2.results.map((r: any) => r.instructionId);
      expect(r2ids).toContain('cov-group-skill-001');
      expect(r2ids).not.toContain('cov-individual-instruction-001');

      const r3 = await handleInstructionsSearch({ fields: { contentType: 'prompt' } } as any);
      expect(r3.results.map((r: any) => r.instructionId)).toContain('cov-all-prompt-001');
    });

    it('FL-41: fields.status=draft matches the draft-only entry', async () => {
      const result = await handleInstructionsSearch({ fields: { status: 'draft' } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-individual-instruction-001');
      expect(ids).not.toContain('cov-group-skill-001');
    });

    it('FL-42: fields.priorityTier covers P3 and P4', async () => {
      const r3 = await handleInstructionsSearch({ fields: { priorityTier: 'P3' } } as any);
      expect(r3.results.map((r: any) => r.instructionId)).toContain('cov-all-prompt-001');

      const r4 = await handleInstructionsSearch({ fields: { priorityTier: 'P4' } } as any);
      expect(r4.results.map((r: any) => r.instructionId)).toContain('cov-all-workflow-archived-001');
    });

    it('FL-43: fields.classification covers public and restricted', async () => {
      const rPub = await handleInstructionsSearch({ fields: { classification: 'public' } } as any);
      expect(rPub.results.map((r: any) => r.instructionId)).toContain('cov-individual-instruction-001');

      const rRes = await handleInstructionsSearch({ fields: { classification: 'restricted' } } as any);
      expect(rRes.results.map((r: any) => r.instructionId)).toContain('cov-all-workflow-archived-001');
    });

    // ── FL-44..FL-46: teamIdsAny / All / None virtual operators ─────────

    it('FL-44: fields.teamIdsAny matches entries containing any listed team id', async () => {
      const result = await handleInstructionsSearch({ fields: { teamIdsAny: ['team-alpha'] } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-individual-instruction-001');
      expect(ids).toContain('cov-group-skill-001');
      expect(ids).not.toContain('cov-all-prompt-001');
    });

    it('FL-45: fields.teamIdsAll matches only entries containing all listed teams', async () => {
      const result = await handleInstructionsSearch({ fields: { teamIdsAll: ['team-alpha', 'team-beta'] } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-individual-instruction-001');
      expect(ids).not.toContain('cov-group-skill-001');
    });

    it('FL-46: fields.teamIdsNone excludes entries containing the listed team', async () => {
      const result = await handleInstructionsSearch({ fields: { teamIdsNone: ['team-alpha'] } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).not.toContain('cov-individual-instruction-001');
      expect(ids).not.toContain('cov-group-skill-001');
      expect(ids).toContain('cov-all-prompt-001');
      expect(ids).toContain('cov-all-workflow-archived-001');
    });

    // ── FL-47..FL-49: numeric range virtual operators ──────────────────

    it('FL-47: fields.usageCountMin/Max define inclusive numeric range', async () => {
      const result = await handleInstructionsSearch({ fields: { usageCountMin: 1, usageCountMax: 50 } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-individual-instruction-001'); // 50, boundary inclusive
      expect(ids).toContain('cov-group-skill-001'); // 5
      expect(ids).not.toContain('cov-all-prompt-001'); // 0 < min
      expect(ids).not.toContain('cov-all-workflow-archived-001'); // 100 > max
    });

    it('FL-48: fields.riskScoreMin/Max filters by riskScore range', async () => {
      const result = await handleInstructionsSearch({ fields: { riskScoreMin: 4, riskScoreMax: 9 } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-group-skill-001'); // 5
      expect(ids).toContain('cov-all-prompt-001'); // 9 boundary inclusive
      expect(ids).not.toContain('cov-individual-instruction-001'); // 1
      expect(ids).not.toContain('cov-all-workflow-archived-001'); // 3
    });

    it('FL-49: fields.reviewIntervalDaysMin/Max filters by review interval', async () => {
      const result = await handleInstructionsSearch({ fields: { reviewIntervalDaysMin: 60, reviewIntervalDaysMax: 200 } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-group-skill-001'); // 90
      expect(ids).toContain('cov-all-prompt-001'); // 180
      expect(ids).not.toContain('cov-individual-instruction-001'); // 30 < min
      expect(ids).not.toContain('cov-all-workflow-archived-001'); // 365 > max
    });

    // ── FL-50..FL-55: date virtual operators (created/firstSeen/lastUsed/lastReviewed/nextReviewDue/archived) ──

    it('FL-50: fields.createdAfter/Before filters by createdAt', async () => {
      const result = await handleInstructionsSearch({ fields: { createdAfter: '2026-01-01T00:00:00Z', createdBefore: '2026-02-28T00:00:00Z' } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-individual-instruction-001'); // Jan 1 boundary
      expect(ids).toContain('cov-group-skill-001'); // Feb 1
      expect(ids).not.toContain('cov-all-prompt-001'); // Mar 1
      expect(ids).not.toContain('cov-all-workflow-archived-001'); // 2025
    });

    it('FL-51: fields.firstSeenAfter/Before filters by firstSeenTs', async () => {
      const result = await handleInstructionsSearch({ fields: { firstSeenAfter: '2026-02-01T00:00:00Z', firstSeenBefore: '2026-03-31T00:00:00Z' } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-group-skill-001'); // Feb 2
      expect(ids).toContain('cov-all-prompt-001'); // Mar 2
      expect(ids).not.toContain('cov-individual-instruction-001'); // Jan 2
      expect(ids).not.toContain('cov-all-workflow-archived-001'); // 2025
    });

    it('FL-52: fields.lastUsedAfter/Before filters by lastUsedAt', async () => {
      const result = await handleInstructionsSearch({ fields: { lastUsedAfter: '2026-01-01T00:00:00Z', lastUsedBefore: '2026-01-31T00:00:00Z' } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-individual-instruction-001'); // Jan 20
      expect(ids).not.toContain('cov-group-skill-001'); // Feb 20
    });

    it('FL-53: fields.lastReviewedAfter/Before filters by lastReviewedAt', async () => {
      const result = await handleInstructionsSearch({ fields: { lastReviewedAfter: '2026-02-01T00:00:00Z' } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-group-skill-001'); // Feb 10
      expect(ids).toContain('cov-all-prompt-001'); // Mar 10
      expect(ids).not.toContain('cov-individual-instruction-001'); // Jan 10
    });

    it('FL-54: fields.nextReviewDueAfter/Before filters by nextReviewDue', async () => {
      const result = await handleInstructionsSearch({ fields: { nextReviewDueBefore: '2026-03-01T00:00:00Z' } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-individual-instruction-001'); // Feb 10
      expect(ids).not.toContain('cov-group-skill-001'); // May 10
      expect(ids).not.toContain('cov-all-prompt-001'); // Sep 10
    });

    it('FL-55: fields.archivedAfter/Before filters by archivedAt and excludes entries without archivedAt', async () => {
      const result = await handleInstructionsSearch({ fields: { archivedBefore: '2026-01-01T00:00:00Z' } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-all-workflow-archived-001'); // 2025-12-01
      // Entries without archivedAt must NOT match (compareDateRange requires the field to be a string)
      expect(ids).not.toContain('cov-individual-instruction-001');
      expect(ids).not.toContain('cov-group-skill-001');
      expect(ids).not.toContain('cov-all-prompt-001');
    });

    // ── FL-56..FL-58: previously-uncovered canonical field predicates ──

    it('FL-56: fields.workspaceId scalar exact match', async () => {
      const result = await handleInstructionsSearch({ fields: { workspaceId: 'ws-alpha' } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-individual-instruction-001');
      expect(ids).toContain('cov-all-prompt-001');
      expect(ids).not.toContain('cov-group-skill-001'); // ws-beta
      expect(ids).not.toContain('cov-all-workflow-archived-001'); // ws-gamma
    });

    it('FL-57: fields.version scalar exact match', async () => {
      const result = await handleInstructionsSearch({ fields: { version: '2.1.0' } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-group-skill-001');
      expect(ids).not.toContain('cov-individual-instruction-001');
    });

    it('FL-58: fields.supersedes scalar exact match', async () => {
      const result = await handleInstructionsSearch({ fields: { supersedes: 'cov-legacy-old-001' } } as any);
      const ids = result.results.map((r: any) => r.instructionId);
      expect(ids).toContain('cov-individual-instruction-001');
      // Other entries have no supersedes set
      expect(ids).not.toContain('cov-group-skill-001');
    });

    // ── FL-59..FL-60: invalid-value rejections for new operators ───────

    it('FL-59: inverted numeric range on usageCount is rejected', async () => {
      await expect(handleInstructionsSearch({ fields: { usageCountMin: 100, usageCountMax: 1 } } as any)).rejects.toThrow();
    });

    it('FL-60: inverted date range on lastUsed is rejected', async () => {
      await expect(handleInstructionsSearch({ fields: { lastUsedAfter: '2026-06-01T00:00:00Z', lastUsedBefore: '2026-01-01T00:00:00Z' } } as any)).rejects.toThrow();
    });
  });
});
