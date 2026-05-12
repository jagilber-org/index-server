/**
 * Admin Feedback CRUD Routes — Human-operator management of persisted feedback entries.
 *
 * Routes:
 *   GET    /admin/feedback       — list all entries
 *   POST   /admin/feedback       — create a new entry
 *   GET    /admin/feedback/:id   — get a single entry
 *   PATCH  /admin/feedback/:id   — update entry fields (e.g., status)
 *   DELETE /admin/feedback/:id   — remove an entry
 *
 * Storage: shared via src/services/feedbackStorage.ts (no I/O duplication with MCP layer).
 * This surface is NOT the webhook/external-connector surface in api.feedback.routes.ts.
 */

import { Router, Request, Response } from 'express';
import { dashboardAdminAuth } from './adminAuth.js';
import {
  loadFeedbackStorage,
  saveFeedbackStorage,
  generateFeedbackId,
  FeedbackEntry,
  FEEDBACK_TYPES,
  FEEDBACK_SEVERITIES,
  FEEDBACK_STATUSES,
} from '../../../services/feedbackStorage.js';
import { logAudit } from '../../../services/auditLog.js';

const VALID_TYPES = new Set<string>(FEEDBACK_TYPES);
const VALID_SEVERITIES = new Set<string>(FEEDBACK_SEVERITIES);
const VALID_STATUSES = new Set<string>(FEEDBACK_STATUSES);
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 10_000;
const MAX_TAGS = 10;

function sanitizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = value
    .filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.trim())
    .filter(Boolean)
    .slice(0, MAX_TAGS);
  return tags.length > 0 ? tags : undefined;
}

export function createAdminFeedbackRoutes(): Router {
  const router = Router();

  /** GET /admin/feedback — list all persisted feedback entries */
  router.get('/admin/feedback', dashboardAdminAuth, (_req: Request, res: Response) => {
    try {
      const storage = loadFeedbackStorage();
      res.json({
        entries: storage.entries,
        total: storage.entries.length,
        lastUpdated: storage.lastUpdated,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to load feedback entries', message: String(error) });
    }
  });

  /** POST /admin/feedback — create a new feedback entry */
  router.post('/admin/feedback', dashboardAdminAuth, (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const { type, severity, title, description } = body;

      if (!title || typeof title !== 'string' || !title.trim()) {
        res.status(400).json({ error: 'Missing required field: title' });
        return;
      }
      if (!type || !VALID_TYPES.has(String(type))) {
        res.status(400).json({
          error: `Missing or invalid field: type. Must be one of: ${[...VALID_TYPES].join(', ')}`,
        });
        return;
      }
      if (!severity || !VALID_SEVERITIES.has(String(severity))) {
        res.status(400).json({
          error: `Missing or invalid field: severity. Must be one of: ${[...VALID_SEVERITIES].join(', ')}`,
        });
        return;
      }

      const timestamp = new Date().toISOString();
      const id = generateFeedbackId(String(type), timestamp);
      const entry: FeedbackEntry = {
        id,
        timestamp,
        type: type as FeedbackEntry['type'],
        severity: severity as FeedbackEntry['severity'],
        title: title.trim().slice(0, MAX_TITLE_LENGTH),
        description: description ? String(description).slice(0, MAX_DESCRIPTION_LENGTH) : '',
        status: 'new' as const,
      };
      const tags = sanitizeTags(body.tags);
      if (tags) entry.tags = tags;
      if (body.metadata && typeof body.metadata === 'object') {
        entry.metadata = body.metadata as Record<string, unknown>;
      }

      const storage = loadFeedbackStorage();
      storage.entries.push(entry);
      saveFeedbackStorage(storage);
      logAudit('admin/feedback/create', [id], { title: entry.title, type: entry.type });

      res.status(201).json(entry);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create feedback entry', message: String(error) });
    }
  });

  /** GET /admin/feedback/:id — retrieve a single entry by id */
  router.get('/admin/feedback/:id', dashboardAdminAuth, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const storage = loadFeedbackStorage();
      const entry = storage.entries.find(e => e.id === id);
      if (!entry) {
        res.status(404).json({ error: `Feedback entry not found: ${id}` });
        return;
      }
      res.json(entry);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get feedback entry', message: String(error) });
    }
  });

  /** PATCH /admin/feedback/:id — update mutable fields on an entry */
  router.patch('/admin/feedback/:id', dashboardAdminAuth, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const body = req.body as Record<string, unknown>;
      const storage = loadFeedbackStorage();
      const idx = storage.entries.findIndex(e => e.id === id);
      if (idx === -1) {
        res.status(404).json({ error: `Feedback entry not found: ${id}` });
        return;
      }

      const entry = { ...storage.entries[idx] };

      if (body.status !== undefined) {
        if (!VALID_STATUSES.has(String(body.status))) {
          res.status(400).json({
            error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}`,
          });
          return;
        }
        entry.status = body.status as FeedbackEntry['status'];
      }
      if (body.title !== undefined && typeof body.title === 'string') {
        entry.title = body.title.trim().slice(0, MAX_TITLE_LENGTH);
      }
      if (body.description !== undefined && typeof body.description === 'string') {
        entry.description = body.description.slice(0, MAX_DESCRIPTION_LENGTH);
      }
      if (body.severity !== undefined) {
        if (!VALID_SEVERITIES.has(String(body.severity))) {
          res.status(400).json({
            error: `Invalid severity. Must be one of: ${[...VALID_SEVERITIES].join(', ')}`,
          });
          return;
        }
        entry.severity = body.severity as FeedbackEntry['severity'];
      }
      if (body.tags !== undefined) {
        entry.tags = sanitizeTags(body.tags);
      }

      storage.entries[idx] = entry;
      saveFeedbackStorage(storage);
      logAudit('admin/feedback/update', [id], { fields: Object.keys(body) });

      res.json(entry);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update feedback entry', message: String(error) });
    }
  });

  /** DELETE /admin/feedback/:id — remove an entry */
  router.delete('/admin/feedback/:id', dashboardAdminAuth, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const storage = loadFeedbackStorage();
      const idx = storage.entries.findIndex(e => e.id === id);
      if (idx === -1) {
        res.status(404).json({ error: `Feedback entry not found: ${id}` });
        return;
      }
      storage.entries.splice(idx, 1);
      saveFeedbackStorage(storage);
      logAudit('admin/feedback/delete', [id]);

      res.status(200).json({ deleted: true, id });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete feedback entry', message: String(error) });
    }
  });

  return router;
}
