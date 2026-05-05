/**
 * Express middleware that calls ensureLoaded() once per request and attaches
 * the IndexState to res.locals.indexState. This eliminates redundant filesystem
 * I/O from repeated ensureLoaded() calls within a single request cycle.
 *
 * Route handlers that only need a read-consistent snapshot should use
 * res.locals.indexState instead of calling ensureLoaded() directly.
 * Mutation handlers that call invalidate() must still call ensureLoaded()
 * explicitly after invalidation to pick up their own changes.
 *
 * See internal tracker #45.
 */

import { Request, Response, NextFunction } from 'express';
import { ensureLoadedAsync, IndexState } from '../../../services/indexContext.js';

/**
 * Augment Express res.locals with the pre-loaded index state.
 */
export interface IndexLocals {
  indexState: IndexState;
}

/**
 * Middleware that eagerly loads the instruction index once per request.
 * Attach to any router whose handlers need index state.
 */
export async function ensureLoadedMiddleware(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.locals.indexState = await ensureLoadedAsync();
    next();
  } catch (error) {
    next(error);
  }
}
