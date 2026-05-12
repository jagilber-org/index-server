/**
 * MCP feedback handlers.
 *
 * feedback_submit remains a standalone alias for quick agent reporting.
 * feedback_manage is the single action-dispatch management surface for
 * submit/list/get/update/delete/stats.
 */

import { registerHandler } from '../server/registry';
import { logInfo, logError } from './logger';
import { logAudit } from './auditLog';
import {
  FeedbackEntry,
  FeedbackStorage,
  FeedbackType,
  FeedbackSeverity,
  FeedbackStatus,
  FEEDBACK_TYPES,
  FEEDBACK_SEVERITIES,
  FEEDBACK_STATUSES,
  getMaxEntries,
  loadFeedbackStorage,
  saveFeedbackStorage,
  generateFeedbackId,
} from './feedbackStorage';

const VALID_TYPES = FEEDBACK_TYPES;
const VALID_SEVERITIES = FEEDBACK_SEVERITIES;
const VALID_STATUSES = FEEDBACK_STATUSES;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 10_000;
const MAX_TAGS = 10;
const MAX_LIST_LIMIT = 200;

type FeedbackAction = 'submit' | 'list' | 'get' | 'update' | 'delete' | 'stats';
type FeedbackErrorCode = 'not_found' | 'missing_required' | 'invalid_param' | 'storage_error';

interface FeedbackSubmitParams {
  type?: string;
  severity?: string;
  title?: string;
  description?: string;
  context?: FeedbackEntry['context'];
  metadata?: Record<string, unknown>;
  tags?: unknown;
}

interface FeedbackManageParams extends FeedbackSubmitParams {
  action?: string;
  id?: string;
  status?: string;
  limit?: number;
  offset?: number;
  since?: string;
}

interface FeedbackErrorEnvelope {
  action: string;
  success: false;
  error: FeedbackErrorCode;
  message: string;
  hint?: string;
  id?: string;
}

function errorEnvelope(
  action: string | undefined,
  error: FeedbackErrorCode,
  message: string,
  opts: { hint?: string; id?: string } = {},
): FeedbackErrorEnvelope {
  return {
    action: action || 'unknown',
    success: false,
    error,
    message,
    ...opts,
  };
}

function isFeedbackType(value: string): value is FeedbackType {
  return (VALID_TYPES as readonly string[]).includes(value);
}

function isFeedbackSeverity(value: string): value is FeedbackSeverity {
  return (VALID_SEVERITIES as readonly string[]).includes(value);
}

function isFeedbackStatus(value: string): value is FeedbackStatus {
  return (VALID_STATUSES as readonly string[]).includes(value);
}

function sanitizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = value
    .filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.trim())
    .filter(Boolean)
    .slice(0, MAX_TAGS);
  return tags.length > 0 ? tags : undefined;
}

function validateSubmitParams(params: FeedbackSubmitParams): FeedbackErrorEnvelope | undefined {
  const missing = ['type', 'severity', 'title', 'description'].filter((field) => {
    const value = params[field as keyof FeedbackSubmitParams];
    return typeof value !== 'string' || !value.trim();
  });
  if (missing.length) {
    return errorEnvelope('submit', 'missing_required', `Missing required parameter(s): ${missing.join(', ')}`, {
      hint: 'Submit requires type, severity, title, and description.',
    });
  }
  if (!isFeedbackType(params.type!)) {
    return errorEnvelope('submit', 'invalid_param', `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`);
  }
  if (!isFeedbackSeverity(params.severity!)) {
    return errorEnvelope('submit', 'invalid_param', `Invalid severity. Must be one of: ${VALID_SEVERITIES.join(', ')}`);
  }
  if (params.tags !== undefined && !Array.isArray(params.tags)) {
    return errorEnvelope('submit', 'invalid_param', 'Invalid tags. Must be an array of strings.');
  }
  return undefined;
}

function createFeedbackEntry(params: FeedbackSubmitParams): FeedbackEntry {
  const timestamp = new Date().toISOString();
  const entry: FeedbackEntry = {
    id: generateFeedbackId(params.type!, timestamp),
    timestamp,
    type: params.type as FeedbackType,
    severity: params.severity as FeedbackSeverity,
    title: params.title!.trim().slice(0, MAX_TITLE_LENGTH),
    description: params.description!.slice(0, MAX_DESCRIPTION_LENGTH),
    context: params.context,
    metadata: params.metadata,
    tags: sanitizeTags(params.tags),
    status: 'new',
  };
  return entry;
}

function emitCriticalFeedbackNotice(entry: FeedbackEntry): void {
  if (entry.type !== 'security' && entry.severity !== 'critical') return;
  try {
    process.stderr.write(`[SECURITY/CRITICAL] Feedback ID: ${entry.id}, Type: ${entry.type}, Title: ${entry.title}\n`);
  } catch {
    // Ignore stderr write failures.
  }
}

function persistSubmittedFeedback(params: FeedbackSubmitParams): FeedbackEntry {
  const entry = createFeedbackEntry(params);
  const storage = loadFeedbackStorage();
  storage.entries.push(entry);
  saveFeedbackStorage(storage);
  logAudit('feedback_submit', [entry.id], {
    type: entry.type,
    severity: entry.severity,
    title: entry.title,
  }, 'feedback');
  logInfo('[feedback] Feedback submitted', {
    id: entry.id,
    type: entry.type,
    severity: entry.severity,
    title: entry.title,
  });
  emitCriticalFeedbackNotice(entry);
  return entry;
}

function submitFeedbackOrThrow(params: FeedbackSubmitParams) {
  const validationError = validateSubmitParams(params);
  if (validationError) throw new Error(validationError.message);
  const entry = persistSubmittedFeedback(params);
  return {
    success: true,
    feedbackId: entry.id,
    timestamp: entry.timestamp,
    message: 'Feedback submitted successfully',
  };
}

function submitFeedbackManaged(params: FeedbackSubmitParams) {
  const validationError = validateSubmitParams(params);
  if (validationError) return validationError;
  try {
    const entry = persistSubmittedFeedback(params);
    return {
      action: 'submit',
      success: true,
      feedbackId: entry.id,
      entry,
      timestamp: entry.timestamp,
      message: 'Feedback submitted successfully',
    };
  } catch (error) {
    logError('[feedback] feedback_manage submit storage failure', error instanceof Error ? error : { error: String(error) });
    logAudit('feedback_manage_storage_error', undefined, { action: 'submit' }, 'feedback');
    return errorEnvelope('submit', 'storage_error', 'Feedback submit failed due to a storage error. The error details are not exposed to clients.');
  }
}

function loadStorageManaged(action: FeedbackAction): FeedbackStorage | FeedbackErrorEnvelope {
  try {
    return loadFeedbackStorage();
  } catch (error) {
    logError('[feedback] feedback_manage storage load failure', error instanceof Error ? error : { error: String(error), action });
    logAudit('feedback_manage_storage_error', undefined, { action }, 'feedback');
    return errorEnvelope(action, 'storage_error', 'Feedback storage could not be loaded. The error details are not exposed to clients.');
  }
}

function saveStorageManaged(action: FeedbackAction, storage: FeedbackStorage, id?: string): FeedbackErrorEnvelope | undefined {
  try {
    saveFeedbackStorage(storage);
    return undefined;
  } catch (error) {
    logError('[feedback] feedback_manage storage save failure', error instanceof Error ? error : { error: String(error), action, id });
    logAudit('feedback_manage_storage_error', id ? [id] : undefined, { action }, 'feedback');
    return errorEnvelope(action, 'storage_error', 'Feedback update failed due to a storage error. The error details are not exposed to clients.', { id });
  }
}

function requireId(action: FeedbackAction, id: unknown): string | FeedbackErrorEnvelope {
  if (typeof id !== 'string' || !id.trim()) {
    return errorEnvelope(action, 'missing_required', 'Missing required parameter: id', {
      hint: `${action} requires a feedback entry id.`,
    });
  }
  return id;
}

function listFeedback(params: FeedbackManageParams) {
  const storage = loadStorageManaged('list');
  if ('success' in storage) return storage;
  let entries = [...storage.entries];

  if (params.type !== undefined) {
    if (!isFeedbackType(String(params.type))) return errorEnvelope('list', 'invalid_param', `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`);
    entries = entries.filter(entry => entry.type === params.type);
  }
  if (params.severity !== undefined) {
    if (!isFeedbackSeverity(String(params.severity))) return errorEnvelope('list', 'invalid_param', `Invalid severity. Must be one of: ${VALID_SEVERITIES.join(', ')}`);
    entries = entries.filter(entry => entry.severity === params.severity);
  }
  if (params.status !== undefined) {
    if (!isFeedbackStatus(String(params.status))) return errorEnvelope('list', 'invalid_param', `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
    entries = entries.filter(entry => entry.status === params.status);
  }
  if (params.since !== undefined) {
    if (Number.isNaN(Date.parse(params.since))) return errorEnvelope('list', 'invalid_param', 'Invalid since. Must be an ISO-compatible date string.');
    entries = entries.filter(entry => entry.timestamp >= params.since!);
  }
  if (params.tags !== undefined) {
    if (!Array.isArray(params.tags)) return errorEnvelope('list', 'invalid_param', 'Invalid tags. Must be an array of strings.');
    const tags = sanitizeTags(params.tags) ?? [];
    if (tags.length) {
      entries = entries.filter(entry => entry.tags?.some(tag => tags.includes(tag)));
    }
  }

  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const limit = params.limit === undefined ? 50 : params.limit;
  const offset = params.offset === undefined ? 0 : params.offset;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    return errorEnvelope('list', 'invalid_param', `Invalid limit. Must be an integer from 1 to ${MAX_LIST_LIMIT}.`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return errorEnvelope('list', 'invalid_param', 'Invalid offset. Must be a non-negative integer.');
  }

  return {
    action: 'list',
    success: true,
    entries: entries.slice(offset, offset + limit),
    total: entries.length,
    limit,
    offset,
    hasMore: offset + limit < entries.length,
    lastUpdated: storage.lastUpdated,
  };
}

function getFeedback(params: FeedbackManageParams) {
  const id = requireId('get', params.id);
  if (typeof id !== 'string') return id;
  const storage = loadStorageManaged('get');
  if ('success' in storage) return storage;
  const entry = storage.entries.find(item => item.id === id);
  if (!entry) {
    return errorEnvelope('get', 'not_found', `Feedback entry not found: ${id}`, {
      id,
      hint: 'Use feedback_manage with action=list to inspect available entries.',
    });
  }
  return { action: 'get', success: true, entry };
}

function updateFeedback(params: FeedbackManageParams) {
  const id = requireId('update', params.id);
  if (typeof id !== 'string') return id;
  const storage = loadStorageManaged('update');
  if ('success' in storage) return storage;
  const index = storage.entries.findIndex(item => item.id === id);
  if (index === -1) {
    return errorEnvelope('update', 'not_found', `Feedback entry not found: ${id}`, {
      id,
      hint: 'Use feedback_manage with action=list to inspect available entries.',
    });
  }

  const entry = { ...storage.entries[index] };
  const updatedFields: string[] = [];
  if (params.status !== undefined) {
    if (!isFeedbackStatus(String(params.status))) return errorEnvelope('update', 'invalid_param', `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`, { id });
    entry.status = params.status as FeedbackStatus;
    updatedFields.push('status');
  }
  if (params.title !== undefined) {
    if (typeof params.title !== 'string' || !params.title.trim()) return errorEnvelope('update', 'invalid_param', 'Invalid title. Must be a non-empty string.', { id });
    entry.title = params.title.trim().slice(0, MAX_TITLE_LENGTH);
    updatedFields.push('title');
  }
  if (params.description !== undefined) {
    if (typeof params.description !== 'string') return errorEnvelope('update', 'invalid_param', 'Invalid description. Must be a string.', { id });
    entry.description = params.description.slice(0, MAX_DESCRIPTION_LENGTH);
    updatedFields.push('description');
  }
  if (params.severity !== undefined) {
    if (!isFeedbackSeverity(String(params.severity))) return errorEnvelope('update', 'invalid_param', `Invalid severity. Must be one of: ${VALID_SEVERITIES.join(', ')}`, { id });
    entry.severity = params.severity as FeedbackSeverity;
    updatedFields.push('severity');
  }
  if (params.tags !== undefined) {
    if (!Array.isArray(params.tags)) return errorEnvelope('update', 'invalid_param', 'Invalid tags. Must be an array of strings.', { id });
    entry.tags = sanitizeTags(params.tags);
    updatedFields.push('tags');
  }
  if (params.metadata !== undefined) {
    if (!params.metadata || typeof params.metadata !== 'object' || Array.isArray(params.metadata)) {
      return errorEnvelope('update', 'invalid_param', 'Invalid metadata. Must be an object.', { id });
    }
    entry.metadata = { ...entry.metadata, ...params.metadata };
    updatedFields.push('metadata');
  }
  if (!updatedFields.length) {
    return errorEnvelope('update', 'missing_required', 'No update fields provided.', {
      id,
      hint: 'Provide one or more of status, title, description, severity, tags, or metadata.',
    });
  }

  storage.entries[index] = entry;
  const saveError = saveStorageManaged('update', storage, id);
  if (saveError) return saveError;
  logAudit('feedback_manage_update', [id], { fields: updatedFields }, 'feedback');
  logInfo('[feedback] Feedback entry updated', { id, fields: updatedFields });
  return {
    action: 'update',
    success: true,
    entry,
    message: 'Feedback entry updated successfully',
  };
}

function deleteFeedback(params: FeedbackManageParams) {
  const id = requireId('delete', params.id);
  if (typeof id !== 'string') return id;
  const storage = loadStorageManaged('delete');
  if ('success' in storage) return storage;
  const index = storage.entries.findIndex(item => item.id === id);
  if (index === -1) {
    return errorEnvelope('delete', 'not_found', `Feedback entry not found: ${id}`, {
      id,
      hint: 'Use feedback_manage with action=list to inspect available entries.',
    });
  }
  storage.entries.splice(index, 1);
  const saveError = saveStorageManaged('delete', storage, id);
  if (saveError) return saveError;
  logAudit('feedback_manage_delete', [id], undefined, 'feedback');
  logInfo('[feedback] Feedback entry deleted', { id });
  return {
    action: 'delete',
    success: true,
    deleted: true,
    id,
    message: 'Feedback entry deleted successfully',
  };
}

function feedbackStats(params: FeedbackManageParams) {
  const storage = loadStorageManaged('stats');
  if ('success' in storage) return storage;
  if (params.since !== undefined && Number.isNaN(Date.parse(params.since))) {
    return errorEnvelope('stats', 'invalid_param', 'Invalid since. Must be an ISO-compatible date string.');
  }
  const entries = params.since ? storage.entries.filter(entry => entry.timestamp >= params.since!) : storage.entries;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const stats = {
    total: entries.length,
    byType: {} as Record<string, number>,
    bySeverity: {} as Record<string, number>,
    byStatus: {} as Record<string, number>,
    recentActivity: {
      last24h: 0,
      last7d: 0,
      last30d: 0,
    },
  };

  for (const entry of entries) {
    stats.byType[entry.type] = (stats.byType[entry.type] || 0) + 1;
    stats.bySeverity[entry.severity] = (stats.bySeverity[entry.severity] || 0) + 1;
    stats.byStatus[entry.status] = (stats.byStatus[entry.status] || 0) + 1;
    const age = now - new Date(entry.timestamp).getTime();
    if (age <= day) stats.recentActivity.last24h += 1;
    if (age <= 7 * day) stats.recentActivity.last7d += 1;
    if (age <= 30 * day) stats.recentActivity.last30d += 1;
  }

  return {
    action: 'stats',
    success: true,
    stats,
    storageInfo: {
      lastUpdated: storage.lastUpdated,
      version: storage.version,
      maxEntries: getMaxEntries(),
    },
  };
}

registerHandler('feedback_submit', (params: FeedbackSubmitParams) => {
  try {
    return submitFeedbackOrThrow(params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('Missing required parameter') && !message.startsWith('Invalid ')) {
      logError('[feedback] feedback_submit storage failure', error instanceof Error ? error : { error: message });
      logAudit('feedback_submit_storage_error', undefined, {}, 'feedback');
      throw new Error('Feedback submit failed due to a storage error. The error details are not exposed to clients.');
    }
    throw error;
  }
});

registerHandler('feedback_manage', (params: FeedbackManageParams) => {
  try {
    const action = params?.action;
    if (!action) {
      return errorEnvelope('unknown', 'missing_required', 'Missing required parameter: action', {
        hint: 'Use one of: submit, list, get, update, delete, stats.',
      });
    }
    if (!['submit', 'list', 'get', 'update', 'delete', 'stats'].includes(action)) {
      return errorEnvelope(action, 'invalid_param', 'Invalid action. Must be one of: submit, list, get, update, delete, stats.');
    }

    switch (action as FeedbackAction) {
      case 'submit': return submitFeedbackManaged(params);
      case 'list': return listFeedback(params);
      case 'get': return getFeedback(params);
      case 'update': return updateFeedback(params);
      case 'delete': return deleteFeedback(params);
      case 'stats': return feedbackStats(params);
    }
  } catch (error) {
    const action = params?.action || 'unknown';
    logError('[feedback] feedback_manage unexpected failure', error instanceof Error ? error : { error: String(error), action });
    logAudit('feedback_manage_storage_error', undefined, { action }, 'feedback');
    return errorEnvelope(action, 'storage_error', 'Feedback management failed due to a storage error. The error details are not exposed to clients.');
  }
});
