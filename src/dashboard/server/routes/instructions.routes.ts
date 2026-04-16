/**
 * Instructions Management Routes
 * Routes: GET /instructions, GET /instructions_search, GET /instructions_categories,
 *         GET /instructions/:name, POST /instructions, PUT /instructions/:name,
 *         DELETE /instructions/:name
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getRuntimeConfig } from '../../../config/runtimeConfig.js';
import { getLocalHandler } from '../../../server/registry.js';
import { ensureLoaded } from '../../../services/indexContext.js';
import { handleInstructionsSearch } from '../../../services/handlers.search.js';

function resolveInstructionsDir(): string {
  const config = getRuntimeConfig();
  const configured = config.dashboard.admin.instructionsDir || config.index.baseDir;
  return configured && configured.trim().length ? configured : path.join(process.cwd(), 'instructions');
}

function ensureInstructionsDir(): string {
  const instructionsDir = resolveInstructionsDir();
  try {
    if (!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir, { recursive: true });
  } catch {
    // ignore
  }
  return instructionsDir;
}

/** Sanitize an instruction name and return the resolved file path, preventing path traversal. */
function safeInstructionPath(instructionsDir: string, name: string): string {
  const safeName = String(name).replace(/[^a-zA-Z0-9-_]/g, '-');
  const file = path.join(instructionsDir, safeName + '.json');
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(instructionsDir) + path.sep) && resolved !== path.resolve(instructionsDir)) {
    throw new Error('Invalid instruction name');
  }
  return file;
}

export function createInstructionsRoutes(): Router {
  const router = Router();

  const buildSnippet = (parts: Array<string | undefined>, query: string): string => {
    const source = parts.filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join('\n');
    if (!source) return '';
    const snippetWindow = 120;
    const lowerSource = source.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const matchIndex = lowerSource.indexOf(lowerQuery);
    const start = matchIndex === -1 ? 0 : Math.max(0, matchIndex - snippetWindow);
    const end = matchIndex === -1 ? Math.min(source.length, 240) : Math.min(source.length, matchIndex + lowerQuery.length + snippetWindow);
    let snippet = source.slice(start, end).replace(/\s+/g, ' ').trim();
    if (!snippet) return '';
    if (matchIndex !== -1) {
      snippet = snippet.replace(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), match => `**${match}**`);
    }
    return snippet;
  };

  /**
   * GET /api/instructions - list instruction JSON files
   */
  router.get('/instructions', (_req: Request, res: Response) => {
    try {
      const instructionsDir = ensureInstructionsDir();
      const classify = (basename: string): { category: string; sizeCategory: string } => {
        const lower = basename.toLowerCase();
        let category = 'general';
        if (lower.startsWith('alpha')) category = 'alpha';
        else if (lower.startsWith('beta')) category = 'beta';
        else if (lower.includes('seed')) category = 'seed';
        else if (lower.includes('enterprise')) category = 'enterprise';
        else if (lower.includes('dispatcher')) category = 'dispatcher';
        return { category, sizeCategory: 'small' };
      };

      const files = fs.readdirSync(instructionsDir)
        .filter(f => f.toLowerCase().endsWith('.json'))
        .map(f => {
          const abs = path.join(instructionsDir, f);
          const stat = fs.statSync(abs);
          const base = f.replace(/\.json$/i, '');
          const meta = classify(base);
          const sizeCategory = stat.size < 1024 ? 'small' : (stat.size < 5 * 1024 ? 'medium' : 'large');

          let primaryCategory = meta.category;
          let categories: string[] = [];
          let semanticSummary: string | undefined;
          try {
            const raw = fs.readFileSync(abs, 'utf8');
            if (raw.length < 1_000_000) {
              const json = JSON.parse(raw) as unknown;
              const getProp = (obj: unknown, key: string): unknown => {
                if (obj && typeof obj === 'object' && key in (obj as Record<string, unknown>)) {
                  return (obj as Record<string, unknown>)[key];
                }
                return undefined;
              };
              const rawCats = getProp(json, 'categories');
              if (Array.isArray(rawCats)) {
                categories = rawCats
                  .filter((c: unknown): c is string => typeof c === 'string')
                  .map(c => c.trim())
                  .filter(c => !!c);
              }
              const rawPrimary = getProp(json, 'category');
              if (typeof rawPrimary === 'string') {
                const c = rawPrimary.trim();
                if (c) primaryCategory = c;
                if (c && !categories.includes(c)) categories.push(c);
              }
              const fileMeta = getProp(json, 'meta');
              if (fileMeta && typeof fileMeta === 'object') {
                const metaPrimary = getProp(fileMeta, 'category');
                if (typeof metaPrimary === 'string') {
                  const c = metaPrimary.trim();
                  if (c) primaryCategory = c;
                  if (c && !categories.includes(c)) categories.push(c);
                }
                const metaCats = getProp(fileMeta, 'categories');
                if (Array.isArray(metaCats)) {
                  for (const c of metaCats) {
                    if (typeof c === 'string') {
                      const norm = c.trim();
                      if (norm && !categories.includes(norm)) categories.push(norm);
                    }
                  }
                }
                const metaSummary = getProp(fileMeta, 'semanticSummary');
                if (typeof metaSummary === 'string' && metaSummary.trim()) semanticSummary = metaSummary.trim();
              }
              if (!semanticSummary) {
                const topSummary = getProp(json, 'semanticSummary');
                if (typeof topSummary === 'string' && topSummary.trim()) semanticSummary = topSummary.trim();
              }
              if (!semanticSummary) {
                const desc = getProp(json, 'description');
                if (typeof desc === 'string' && desc.trim()) semanticSummary = desc.trim();
              }
              if (!semanticSummary) {
                const body = getProp(json, 'body');
                if (typeof body === 'string' && body.trim()) {
                  const firstLine = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
                  if (firstLine) semanticSummary = firstLine;
                }
              }
              if (semanticSummary) {
                if (semanticSummary.length > 400) semanticSummary = semanticSummary.slice(0, 400) + '…';
              }
            }
          } catch {
            // ignore parse errors; fall back to heuristic classification only
          }

          if (!categories.length && primaryCategory) categories = [primaryCategory];
          categories = Array.from(new Set(categories));

          return {
            name: base,
            size: stat.size,
            mtime: stat.mtimeMs,
            category: primaryCategory,
            categories,
            sizeCategory,
            semanticSummary,
          };
        });

      res.json({ success: true, instructions: files, count: files.length, timestamp: Date.now() });
    } catch (error) {
      console.error('[API] Failed to list instructions:', error);
      res.status(500).json({ success: false, error: 'Failed to list instructions' });
    }
  });

  /**
   * GET /api/instructions_search?q=term&limit=20
   */
  router.get('/instructions_search', async (req: Request, res: Response) => {
    try {
      const instructionsDir = ensureInstructionsDir();
      const qRaw = String(req.query.q || '').trim();
      const query = qRaw.slice(0, 256);
      const limitRaw = parseInt(String(req.query.limit || '20'), 10);
      const limit = Math.min(100, Math.max(1, isNaN(limitRaw) ? 20 : limitRaw));
      if (!query || query.length < 2) {
        return res.json({ success: true, query, count: 0, results: [], note: 'query_too_short' });
      }
      const searchResult = await handleInstructionsSearch({
        keywords: [query],
        limit,
        includeCategories: true,
      });
      const state = ensureLoaded();
      const results: Array<{ name: string; categories: string[]; size: number; mtime: number; snippet: string }> = [];
      for (const match of searchResult.results) {
        try {
          const entry = state.byId.get(match.instructionId);
          if (!entry) continue;
          const abs = path.join(instructionsDir, `${entry.id}.json`);
          const stat = fs.existsSync(abs) ? fs.statSync(abs) : undefined;
          const snippet = buildSnippet([
            entry.id,
            entry.title,
            entry.semanticSummary,
            entry.categories.join(' '),
            entry.body,
          ], query);
          results.push({
            name: entry.id,
            categories: entry.categories.slice(0, 10),
            size: stat?.size ?? Buffer.byteLength(JSON.stringify(entry), 'utf8'),
            mtime: stat?.mtimeMs ?? Date.now(),
            snippet,
          });
        } catch { /* skip file on error */ }
      }
      res.json({ success: true, query, count: results.length, results, timestamp: Date.now() });
    } catch (error) {
      console.error('[API] instructions search error:', error);
      res.status(500).json({ success: false, error: 'search_failed' });
    }
  });

  /**
   * GET /api/instructions_categories - get dynamic categories from actual instructions
   */
  router.get('/instructions_categories', async (_req: Request, res: Response) => {
    try {
      const instructionHandler = getLocalHandler('index_dispatch');
      if (!instructionHandler) {
        return res.status(500).json({ success: false, error: 'Instruction handler not available' });
      }

      const result = await instructionHandler({
        action: 'categories'
      }) as { categories?: Array<{ name: string; count: number }>; count?: number };

      res.json({
        success: true,
        categories: result?.categories || [],
        count: result?.count || 0,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Failed to get categories:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get categories',
      });
    }
  });

  /**
   * GET /api/instructions/:name - get single instruction content
   */
  router.get('/instructions/:name', (req: Request, res: Response) => {
    try {
      const instructionsDir = ensureInstructionsDir();
      const file = safeInstructionPath(instructionsDir, req.params.name);
      if (!fs.existsSync(file)) return res.status(404).json({ success: false, error: 'Not found' });
      const content = JSON.parse(fs.readFileSync(file, 'utf8'));
      res.json({ success: true, content, timestamp: Date.now() });
    } catch (error) {
      console.error('[API] Failed to load instruction:', error);
      res.status(500).json({ success: false, error: 'Failed to load instruction' });
    }
  });

  /**
   * POST /api/instructions - create new instruction
   * body: { name, content }
   */
  router.post('/instructions', (req: Request, res: Response) => {
    try {
      const instructionsDir = ensureInstructionsDir();
      const { name, content } = req.body || {};
      if (!name || !content) return res.status(400).json({ success: false, error: 'Missing name or content' });
      const file = safeInstructionPath(instructionsDir, name);
      const safeName = path.basename(file, '.json');
      if (fs.existsSync(file)) return res.status(409).json({ success: false, error: 'Instruction already exists' });
      fs.writeFileSync(file, JSON.stringify(content, null, 2));
      res.json({ success: true, message: 'Instruction created', name: safeName, timestamp: Date.now() });
    } catch (error) {
      console.error('[API] Failed to create instruction:', error);
      res.status(500).json({ success: false, error: 'Failed to create instruction' });
    }
  });

  /**
   * PUT /api/instructions/:name - update existing instruction
   */
  router.put('/instructions/:name', (req: Request, res: Response) => {
    try {
      const instructionsDir = ensureInstructionsDir();
      const { content } = req.body || {};
      const name = req.params.name;
      if (!content) return res.status(400).json({ success: false, error: 'Missing content' });
      const file = safeInstructionPath(instructionsDir, name);
      if (!fs.existsSync(file)) return res.status(404).json({ success: false, error: 'Not found' });
      fs.writeFileSync(file, JSON.stringify(content, null, 2));
      res.json({ success: true, message: 'Instruction updated', timestamp: Date.now() });
    } catch (error) {
      console.error('[API] Failed to update instruction:', error);
      res.status(500).json({ success: false, error: 'Failed to update instruction' });
    }
  });

  /**
   * DELETE /api/instructions/:name - delete instruction
   */
  router.delete('/instructions/:name', (req: Request, res: Response) => {
    try {
      const instructionsDir = ensureInstructionsDir();
      const file = safeInstructionPath(instructionsDir, req.params.name);
      if (!fs.existsSync(file)) return res.status(404).json({ success: false, error: 'Not found' });
      fs.unlinkSync(file);
      res.json({ success: true, message: 'Instruction deleted', timestamp: Date.now() });
    } catch (error) {
      console.error('[API] Failed to delete instruction:', error);
      res.status(500).json({ success: false, error: 'Failed to delete instruction' });
    }
  });

  return router;
}
