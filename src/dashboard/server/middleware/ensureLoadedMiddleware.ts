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
 * See: https://github.com/jagilber-dev/index-server/issues/45
 */

import { Request, Response, NextFunction } from 'express';
import { ensureLoaded, IndexState } from '../../../services/indexContext.js';

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
export function ensureLoadedMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.locals.indexState = ensureLoaded();
  next();
}
