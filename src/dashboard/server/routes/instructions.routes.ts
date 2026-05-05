/**
 * Instructions Management Routes
 * Routes: GET /instructions, GET /instructions_search, GET /instructions_categories,
 *         GET /instructions/:name, POST /instructions, PUT /instructions/:name,
 *         DELETE /instructions/:name
 */

import path from 'node:path';
import { Router, Request, Response } from 'express';
import { getLocalHandler } from '../../../server/registry.js';
import { ensureLoadedAsync, invalidate, touchIndexVersion, writeEntryAsync, removeEntry, getInstructionsDir, isDuplicateInstructionWriteError } from '../../../services/indexContext.js';
import { dashboardAdminAuth } from './adminAuth.js';
import { handleInstructionsSearch } from '../../../services/handlers.search.js';
import { InstructionEntry } from '../../../models/instruction.js';
import { SCHEMA_VERSION } from '../../../versioning/schemaVersion.js';
import { getRuntimeConfig } from '../../../config/runtimeConfig.js';
import type { IndexLocals } from '../middleware/ensureLoadedMiddleware.js';
import {
  InstructionValidationError,
  isInstructionValidationError,
  validateInstructionIdSurface,
  validateInstructionInputEnumMembership,
} from '../../../services/instructionRecordValidation.js';
import { logError } from '../../../services/logger.js';
import { validatePathContainment } from '../utils/pathContainment.js';

/** Validate an instruction name with a defense-in-depth path-containment guard. */
function safeName(name: string): string {
  const sanitized = String(name);
  const validationErrors = validateInstructionIdSurface(sanitized);
  if (validationErrors.length) {
    throw new InstructionValidationError(validationErrors);
  }
  const base = getInstructionsDir();
  validatePathContainment(path.resolve(base, `${sanitized}.json`), base);
  return sanitized;
}

function requireInstructionContentObject(content: unknown): Record<string, unknown> {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new InstructionValidationError(['/content: must be an object']);
  }
  return content as Record<string, unknown>;
}

function assertValidDashboardInstructionEnums(content: Record<string, unknown>): void {
  const validationErrors = validateInstructionInputEnumMembership(content);
  if (validationErrors.length) {
    throw new InstructionValidationError(validationErrors);
  }
}

function assertValidDashboardInstructionShape(content: Record<string, unknown>): void {
  const validationErrors: string[] = [];
  for (const [key, value] of Object.entries(content)) {
    if (value === null) validationErrors.push(`/${key}: null is not allowed`);
  }
  if (content.title !== undefined && typeof content.title !== 'string') {
    validationErrors.push(`/title: must be a string, received ${typeof content.title}`);
  }
  if (content.body !== undefined && typeof content.body !== 'string') {
    validationErrors.push(`/body: must be a string, received ${typeof content.body}`);
  }
  if (content.audience !== undefined && typeof content.audience !== 'string') {
    validationErrors.push(`/audience: must be a string, received ${typeof content.audience}`);
  }
  if (content.requirement !== undefined && typeof content.requirement !== 'string') {
    validationErrors.push(`/requirement: must be a string, received ${typeof content.requirement}`);
  }
  if (content.contentType !== undefined && typeof content.contentType !== 'string') {
    validationErrors.push(`/contentType: must be a string, received ${typeof content.contentType}`);
  }
  if (content.priority !== undefined && typeof content.priority !== 'number') {
    validationErrors.push(`/priority: must be a number, received ${typeof content.priority}`);
  } else if (typeof content.priority === 'number' && (!Number.isInteger(content.priority) || content.priority < 1 || content.priority > 100)) {
    validationErrors.push('/priority: must be an integer from 1 to 100');
  }
  if (content.categories !== undefined && !Array.isArray(content.categories)) {
    validationErrors.push(`/categories: must be an array of strings, received ${typeof content.categories}`);
  } else if (Array.isArray(content.categories)) {
    for (const [index, category] of content.categories.entries()) {
      if (typeof category !== 'string') {
        validationErrors.push(`/categories/${index}: must be a string, received ${typeof category}`);
      } else if (!/^[a-z0-9][a-z0-9-_]{0,48}$/.test(category.toLowerCase())) {
        validationErrors.push(`/categories/${index}: must match /^[a-z0-9][a-z0-9-_]{0,48}$/`);
      }
    }
  }
  if (validationErrors.length) {
    throw new InstructionValidationError(validationErrors);
  }
}

function assertDashboardBodyWithinLimit(content: Record<string, unknown>): void {
  if (typeof content.body !== 'string') return;
  const bodyLength = content.body.trim().length;
  const { bodyWarnLength } = getRuntimeConfig().index;
  if (bodyLength > bodyWarnLength) {
    throw new InstructionValidationError([`/body: exceeds the ${bodyWarnLength}-character limit (${bodyLength} chars)`]);
  }
}

function validationErrorResponse(res: Response, error: InstructionValidationError): Response {
  return res.status(400).json({ success: false, error: 'invalid_instruction', validationErrors: error.validationErrors });
}

function dashboardAudience(value: unknown): InstructionEntry['audience'] {
  switch (value) {
    case 'individual':
    case 'group':
    case 'all':
      return value;
    default:
      return 'all';
  }
}

function dashboardRequirement(value: unknown): InstructionEntry['requirement'] {
  switch (value) {
    case 'mandatory':
    case 'critical':
    case 'recommended':
    case 'optional':
    case 'deprecated':
      return value;
    default:
      return 'optional';
  }
}

function dashboardContentType(value: unknown): InstructionEntry['contentType'] {
  switch (value) {
    case 'template':
    case 'workflow':
    case 'reference':
    case 'example':
    case 'agent':
    case 'instruction':
      return value;
    default:
      return 'instruction';
  }
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
   * GET /api/instructions - list all instructions from the store
   */
  router.get('/instructions', (_req: Request, res: Response) => { // lgtm[js/missing-rate-limiting] — parent router applies rate-limit
    try {
      const st = (res.locals as IndexLocals).indexState;
      const instructions = st.list.map((entry: InstructionEntry) => {
        const bodyStr = typeof entry.body === 'string' ? entry.body : '';
        const bodySize = Buffer.byteLength(bodyStr, 'utf8');
        const sizeCategory = bodySize < 1024 ? 'small' : (bodySize < 5 * 1024 ? 'medium' : 'large');
        const cats = Array.isArray(entry.categories) ? entry.categories : [];
        const primaryCategory = cats.length > 0 ? cats[0] : 'general';
        let semanticSummary: string | undefined;
        const desc = (entry as unknown as Record<string, unknown>).description;
        if (typeof desc === 'string' && desc.trim()) {
          semanticSummary = desc.trim();
        } else if (bodyStr.trim()) {
          const firstLine = bodyStr.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean)[0];
          if (firstLine) semanticSummary = firstLine;
        }
        if (semanticSummary && semanticSummary.length > 400) semanticSummary = semanticSummary.slice(0, 400) + '…';
        return {
          name: entry.id,
          size: bodySize,
          mtime: entry.updatedAt ? new Date(entry.updatedAt).getTime() : Date.now(),
          category: primaryCategory,
          categories: cats.length ? cats : [primaryCategory],
          sizeCategory,
          semanticSummary,
        };
      });
      res.json({ success: true, instructions, count: instructions.length, timestamp: Date.now() });
    } catch (error) {
      logError('[API] Failed to list instructions:', error);
      res.status(500).json({ success: false, error: 'Failed to list instructions' });
    }
  });

  /**
   * GET /api/instructions_search?q=term&limit=20
   */
  router.get('/instructions_search', async (req: Request, res: Response) => { // lgtm[js/missing-rate-limiting] — parent router applies rate-limit
    try {
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
      const state = (res.locals as IndexLocals).indexState;
      const results: Array<{ name: string; categories: string[]; size: number; mtime: number; snippet: string }> = [];
      for (const match of searchResult.results) {
        try {
          const entry = state.byId.get(match.instructionId);
          if (!entry) continue;
          const bodyStr = typeof entry.body === 'string' ? entry.body : '';
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
            size: Buffer.byteLength(bodyStr, 'utf8'),
            mtime: entry.updatedAt ? new Date(entry.updatedAt).getTime() : Date.now(),
            snippet,
          });
        } catch { /* skip file on error */ }
      }
      res.json({ success: true, query, count: results.length, results, timestamp: Date.now() });
    } catch (error) {
      logError('[API] instructions search error:', error);
      res.status(500).json({ success: false, error: 'search_failed' });
    }
  });

  /**
   * GET /api/instructions_categories - get dynamic categories from actual instructions
   */
  router.get('/instructions_categories', async (_req: Request, res: Response) => { // lgtm[js/missing-rate-limiting] — parent router applies rate-limit
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
      logError('[API] Failed to get categories:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get categories',
      });
    }
  });

  /**
   * GET /api/instructions/:name - get single instruction content
   */
  router.get('/instructions/:name', (req: Request, res: Response) => { // lgtm[js/missing-rate-limiting] — parent router applies rate-limit
    try {
      const id = safeName(req.params.name);
      const st = (res.locals as IndexLocals).indexState;
      const entry = st.byId.get(id);
      if (!entry) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, content: entry, timestamp: Date.now() });
    } catch (error) {
      if (isInstructionValidationError(error)) {
        return validationErrorResponse(res, error);
      }
      logError('[API] Failed to load instruction:', error);
      res.status(500).json({ success: false, error: 'Failed to load instruction' });
    }
  });

  /**
   * POST /api/instructions - create new instruction
   * body: { name, content }
   */
  router.post('/instructions', dashboardAdminAuth, async (req: Request, res: Response) => { // lgtm[js/missing-rate-limiting] — parent router applies rate-limit
    try {
      const { name, content } = req.body || {};
      if (!name || !content) return res.status(400).json({ success: false, error: 'Missing name or content' });
      const id = safeName(name);
      const st = (res.locals as IndexLocals).indexState;
      if (st.byId.has(id)) return res.status(409).json({ success: false, error: 'Instruction already exists' });
      const contentObj = requireInstructionContentObject(content);
      assertValidDashboardInstructionEnums(contentObj);
      assertValidDashboardInstructionShape(contentObj);
      assertDashboardBodyWithinLimit(contentObj);
      const entry: InstructionEntry = {
        ...contentObj,
        id,
        title: typeof contentObj.title === 'string' ? contentObj.title : id,
        body: typeof contentObj.body === 'string' ? contentObj.body : '',
        categories: Array.isArray(contentObj.categories)
          ? contentObj.categories.filter((category): category is string => typeof category === 'string')
          : [],
        priority: typeof contentObj.priority === 'number' ? contentObj.priority : 50,
        audience: dashboardAudience(contentObj.audience),
        requirement: dashboardRequirement(contentObj.requirement),
        contentType: dashboardContentType(contentObj.contentType),
        sourceHash: typeof contentObj.sourceHash === 'string' ? contentObj.sourceHash : '',
        schemaVersion: typeof contentObj.schemaVersion === 'string' ? contentObj.schemaVersion : SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await writeEntryAsync(entry, { createOnly: true }); // lgtm[js/http-to-file-access] — writes to config-controlled instructions directory
      touchIndexVersion();
      invalidate();
      const reloaded = await ensureLoadedAsync();
      const verified = reloaded.byId.has(id);
      if (!verified) {
        logError('[API] Instruction written but NOT visible after reload', { id });
        return res.status(500).json({ success: false, error: 'Instruction written but failed read-back verification' });
      }
      res.json({ success: true, message: 'Instruction created', name: id, verified, timestamp: Date.now() });
    } catch (error) {
      if (isInstructionValidationError(error)) {
        return validationErrorResponse(res, error);
      }
      if (isDuplicateInstructionWriteError(error)) {
        return res.status(409).json({ success: false, error: 'Instruction already exists' });
      }
      logError('[API] Failed to create instruction:', error);
      res.status(500).json({ success: false, error: 'Failed to create instruction' });
    }
  });

  /**
   * PUT /api/instructions/:name - update existing instruction
   */
  router.put('/instructions/:name', dashboardAdminAuth, async (req: Request, res: Response) => { // lgtm[js/missing-rate-limiting] — parent router applies rate-limit
    try {
      const { content } = req.body || {};
      const id = safeName(req.params.name);
      if (!content) return res.status(400).json({ success: false, error: 'Missing content' });
      const contentObj = requireInstructionContentObject(content);
      assertValidDashboardInstructionEnums(contentObj);
      assertValidDashboardInstructionShape(contentObj);
      assertDashboardBodyWithinLimit(contentObj);
      const st = (res.locals as IndexLocals).indexState;
      const existing = st.byId.get(id);
      if (!existing) return res.status(404).json({ success: false, error: 'Not found' });
      const updated: InstructionEntry = {
        ...existing,
        ...contentObj,
        id, // preserve id
        updatedAt: new Date().toISOString(),
      };
      await writeEntryAsync(updated); // lgtm[js/http-to-file-access] — writes to config-controlled instructions directory
      touchIndexVersion();
      invalidate();
      const reloaded = await ensureLoadedAsync();
      const verified = reloaded.byId.has(id);
      if (!verified) {
        logError('[API] Instruction updated but NOT visible after reload', { id });
        return res.status(500).json({ success: false, error: 'Instruction updated but failed read-back verification' });
      }
      res.json({ success: true, message: 'Instruction updated', verified, timestamp: Date.now() });
    } catch (error) {
      if (isInstructionValidationError(error)) {
        return validationErrorResponse(res, error);
      }
      logError('[API] Failed to update instruction:', error);
      res.status(500).json({ success: false, error: 'Failed to update instruction' });
    }
  });

  /**
   * DELETE /api/instructions/:name - delete instruction
   */
  router.delete('/instructions/:name', dashboardAdminAuth, async (req: Request, res: Response) => { // lgtm[js/missing-rate-limiting] — parent router applies rate-limit
    try {
      const id = safeName(req.params.name);
      const st = (res.locals as IndexLocals).indexState;
      if (!st.byId.has(id)) return res.status(404).json({ success: false, error: 'Not found' });
      removeEntry(id);
      touchIndexVersion();
      invalidate();
      await ensureLoadedAsync();
      res.json({ success: true, message: 'Instruction deleted', timestamp: Date.now() });
    } catch (error) {
      if (isInstructionValidationError(error)) {
        return validationErrorResponse(res, error);
      }
      logError('[API] Failed to delete instruction:', error);
      res.status(500).json({ success: false, error: 'Failed to delete instruction' });
    }
  });

  return router;
}
