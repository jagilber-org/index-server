/**
 * MCP feedback handler — submit-only surface.
 *
 * Only feedback_submit is exposed via MCP.
 * Storage I/O is delegated to the shared feedbackStorage module so the
 * dashboard CRUD phase can use the same persisted file without duplicating logic.
 */

import { registerHandler } from '../server/registry';
import { logInfo } from './logger';
import { logAudit } from './auditLog';
import {
  FeedbackEntry,
  loadFeedbackStorage,
  saveFeedbackStorage,
  generateFeedbackId,
} from './feedbackStorage';

registerHandler('feedback_submit', (params: {
  type: string;
  severity: string;
  title: string;
  description: string;
  context?: FeedbackEntry['context'];
  metadata?: Record<string, unknown>;
  tags?: string[];
}) => {
  if (!params.type || !params.severity || !params.title || !params.description) {
    throw new Error('Missing required parameters: type, severity, title, description');
  }

  const validTypes = ['issue', 'status', 'security', 'feature-request', 'bug-report', 'performance', 'usability', 'other'];
  const validSeverities = ['low', 'medium', 'high', 'critical'];

  if (!validTypes.includes(params.type)) {
    throw new Error(`Invalid type. Must be one of: ${validTypes.join(', ')}`);
  }
  if (!validSeverities.includes(params.severity)) {
    throw new Error(`Invalid severity. Must be one of: ${validSeverities.join(', ')}`);
  }

  const timestamp = new Date().toISOString();
  const entry: FeedbackEntry = {
    id: generateFeedbackId(params.type, timestamp),
    timestamp,
    type: params.type as FeedbackEntry['type'],
    severity: params.severity as FeedbackEntry['severity'],
    title: params.title.substring(0, 200),
    description: params.description.substring(0, 10000),
    context: params.context,
    metadata: params.metadata,
    tags: params.tags?.slice(0, 10),
    status: 'new'
  };

  const storage = loadFeedbackStorage();
  storage.entries.push(entry);
  saveFeedbackStorage(storage);

  logAudit('feedback_submit', [entry.id], {
    type: entry.type,
    severity: entry.severity,
    title: entry.title
  }, 'feedback');
  logInfo('[feedback] Feedback submitted', {
    id: entry.id,
    type: entry.type,
    severity: entry.severity,
    title: entry.title
  });

  if (entry.type === 'security' || entry.severity === 'critical') {
    try {
      process.stderr.write(`[SECURITY/CRITICAL] Feedback ID: ${entry.id}, Type: ${entry.type}, Title: ${entry.title}\n`);
    } catch {
      // Ignore stderr write failures
    }
  }

  return {
    success: true,
    feedbackId: entry.id,
    timestamp: entry.timestamp,
    message: 'Feedback submitted successfully'
  };
});
