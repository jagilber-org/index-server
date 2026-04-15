/**
 * Knowledge Store Routes
 * Routes: POST /knowledge, GET /knowledge/search, GET /knowledge/:key
 */

import { Router, Request, Response } from 'express';
import { getKnowledgeStore } from '../KnowledgeStore.js';

export function createKnowledgeRoutes(): Router {
  const router = Router();

  /**
   * POST /api/knowledge - Store or update a knowledge entry
   * Body: { key: string, content: string, metadata?: Record<string, unknown> }
   */
  router.post('/knowledge', (req: Request, res: Response) => {
    try {
      const { key, content, metadata } = req.body;
      if (!key || typeof key !== 'string') {
        return res.status(400).json({ success: false, error: 'Missing required field: key (string)' });
      }
      if (!content || typeof content !== 'string') {
        return res.status(400).json({ success: false, error: 'Missing required field: content (string)' });
      }
      const store = getKnowledgeStore();
      const entry = store.upsert(key, content, metadata || {});
      res.json({ success: true, entry, timestamp: Date.now() });
    } catch (error) {
      console.error('[API] Knowledge store error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to store knowledge entry',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/knowledge/search?q=query&category=cat&limit=20
   */
  router.get('/knowledge/search', (req: Request, res: Response) => {
    try {
      const query = String(req.query.q || '').trim();
      if (!query) {
        return res.json({ success: true, query: '', results: [], count: 0, timestamp: Date.now() });
      }
      const category = req.query.category ? String(req.query.category) : undefined;
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
      const store = getKnowledgeStore();
      const results = store.search(query, { category, limit });
      res.json({
        success: true, query, category: category || null,
        results, count: results.length, totalEntries: store.count(), timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Knowledge search error:', error);
      res.status(500).json({ success: false, error: 'Failed to search knowledge',
        message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  /**
   * GET /api/knowledge/:key - Get a specific knowledge entry
   */
  router.get('/knowledge/:key', (req: Request, res: Response) => {
    try {
      const key = decodeURIComponent(req.params.key);
      const store = getKnowledgeStore();
      const entry = store.get(key);
      if (!entry) {
        return res.status(404).json({ success: false, error: `Knowledge entry not found: ${key}` });
      }
      res.json({ success: true, ...entry, timestamp: Date.now() });
    } catch (error) {
      console.error('[API] Knowledge get error:', error);
      res.status(500).json({ success: false, error: 'Failed to get knowledge entry',
        message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  return router;
}
