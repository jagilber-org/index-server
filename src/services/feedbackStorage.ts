/**
 * Shared feedback storage layer.
 * Used by both the MCP feedback_submit handler and the future dashboard CRUD REST routes.
 * All file I/O lives here — no duplication across consumers.
 */

import { logWarn, logError } from './logger';
import { getRuntimeConfig } from '../config/runtimeConfig';
import fs from 'fs';
import path from 'path';
import { createHash, randomBytes } from 'crypto';

/**
 * Canonical feedback taxonomy.
 * Single source of truth for the three feedback enums. All consumers
 * (handlers.feedback.ts, toolRegistry.ts/.zod.ts, dashboard routes) MUST
 * import these tuples — do not hand-copy the values.
 */
export const FEEDBACK_TYPES = [
  'issue',
  'status',
  'security',
  'feature-request',
  'bug-report',
  'performance',
  'usability',
  'other',
] as const;
export const FEEDBACK_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const FEEDBACK_STATUSES = [
  'new',
  'acknowledged',
  'in-progress',
  'resolved',
  'closed',
] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export type FeedbackSeverity = (typeof FEEDBACK_SEVERITIES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export interface FeedbackEntry {
  id: string;
  timestamp: string;
  type: FeedbackType;
  severity: FeedbackSeverity;
  title: string;
  description: string;
  context?: {
    clientInfo?: {
      name: string;
      version: string;
    };
    serverVersion?: string;
    environment?: Record<string, string>;
    sessionId?: string;
    toolName?: string;
    requestId?: string;
  };
  metadata?: Record<string, unknown>;
  tags?: string[];
  status: FeedbackStatus;
}

export interface FeedbackStorage {
  entries: FeedbackEntry[];
  lastUpdated: string;
  version: string;
}

export function getMaxEntries(): number {
  return getRuntimeConfig().feedback.maxEntries;
}

export function getFeedbackDir(): string {
  return getRuntimeConfig().feedback.dir;
}

export function getFeedbackFile(): string {
  return path.join(getFeedbackDir(), 'feedback-entries.json');
}

export function ensureFeedbackDir(): string {
  const dir = getFeedbackDir();
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); }
    catch (error) { logError('[feedback] Failed to create feedback directory', { error: String(error), dir }); }
  }
  return dir;
}

export function loadFeedbackStorage(): FeedbackStorage {
  const file = getFeedbackFile();
  ensureFeedbackDir();
  try {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(content) as FeedbackStorage;
      if (!parsed.entries || !Array.isArray(parsed.entries)) {
        throw new Error('Invalid feedback storage format');
      }
      return parsed;
    }
  } catch (error) {
    logWarn('[feedback] Failed to load feedback storage, initializing empty', { error: String(error) });
  }
  return { entries: [], lastUpdated: new Date().toISOString(), version: '1.0.0' };
}

export function saveFeedbackStorage(storage: FeedbackStorage): void {
  const file = getFeedbackFile();
  ensureFeedbackDir();
  try {
    const maxEntries = getMaxEntries();
    const entries = storage.entries.length > maxEntries
      ? [...storage.entries]
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, maxEntries)
      : [...storage.entries];
    const content = JSON.stringify({
      ...storage,
      entries,
      lastUpdated: new Date().toISOString(),
    }, null, 2);
    fs.writeFileSync(file, content, 'utf8');
  } catch (error) {
    logError('[feedback] Failed to save feedback storage', error instanceof Error ? error : { error: String(error) });
    throw error;
  }
}

export function generateFeedbackId(type: string, timestamp: string): string {
  const hash = createHash('sha256');
  hash.update(`${type}-${timestamp}-${randomBytes(8).toString('hex')}`);
  return hash.digest('hex').substring(0, 16);
}
