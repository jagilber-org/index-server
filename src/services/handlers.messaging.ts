/**
 * MCP tool handlers for inter-agent messaging.
 *
 * Registers 8 tools via registerHandler() following constitution patterns:
 * - A-1: Side-effect import triggers registration
 * - A-5: Audit logging on mutations
 * - Q-5: registerHandler() pattern
 *
 * Messages are NOT stored in the instruction index (A-3).
 */

import { registerHandler } from '../server/registry';
import { logAudit } from './auditLog';
import { logInfo } from './logger';
import { AgentMailbox } from './messaging/agentMailbox';
import { getRuntimeConfig } from '../config/runtimeConfig';
import {
  SendMessageOptionsSchema,
  ReadMessagesOptionsSchema,
  MAX_TTL_SECONDS,
} from './messaging/messagingTypes';

// Singleton mailbox instance (lazy init)
let _mailbox: AgentMailbox | null = null;

function getMailbox(): AgentMailbox {
  if (!_mailbox) {
    const config = getRuntimeConfig().messaging;
    _mailbox = new AgentMailbox(config);
  }
  return _mailbox;
}

/** Reset mailbox (for testing). */
export function _resetMailbox(): void {
  if (_mailbox) {
    _mailbox.destroy();
    _mailbox = null;
  }
}

// ── messaging_send (MUTATION) ────────────────────────────────────────────────

registerHandler('messaging_send', async (params: {
  channel: string;
  sender: string;
  recipients: string[];
  body: string;
  ttlSeconds?: number;
  persistent?: boolean;
  payload?: Record<string, unknown>;
  priority?: string;
  parentId?: string;
  requiresAck?: boolean;
  ackBySeconds?: number;
  tags?: string[];
}) => {
  const parsed = SendMessageOptionsSchema.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid send options: ${parsed.error.issues.map(i => i.message).join(', ')}`);
  }

  const mailbox = getMailbox();
  const messageId = await mailbox.send(parsed.data);

  logAudit('messaging_send', [messageId], {
    channel: params.channel,
    sender: params.sender,
    priority: params.priority,
  });
  logInfo('[messaging] Message sent', { messageId, channel: params.channel, sender: params.sender });

  return {
    messageId,
    channel: params.channel,
    status: 'sent',
    ttlCapped: params.ttlSeconds ? params.ttlSeconds > MAX_TTL_SECONDS : false,
  };
});

// ── messaging_read (STABLE) ─────────────────────────────────────────────────

registerHandler('messaging_read', (params: {
  channel?: string;
  reader?: string;
  unreadOnly?: boolean;
  limit?: number;
  markRead?: boolean;
  tags?: string[];
  sender?: string;
} = {}) => {
  const parsed = ReadMessagesOptionsSchema.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid read options: ${parsed.error.issues.map(i => i.message).join(', ')}`);
  }

  const mailbox = getMailbox();
  const messages = mailbox.read(parsed.data);

  return {
    channel: params.channel || 'all',
    reader: params.reader || 'anonymous',
    count: messages.length,
    messages,
  };
});

// ── messaging_list_channels (STABLE) ─────────────────────────────────────────

registerHandler('messaging_list_channels', () => {
  const mailbox = getMailbox();
  const channels = mailbox.listChannels();

  return {
    count: channels.length,
    channels,
  };
});

// ── messaging_ack (MUTATION) ─────────────────────────────────────────────────

registerHandler('messaging_ack', (params: {
  messageIds: string[];
  reader: string;
}) => {
  if (!params.messageIds?.length || !params.reader) {
    throw new Error('Missing required parameters: messageIds, reader');
  }

  const mailbox = getMailbox();
  const acknowledged = mailbox.ack(params.messageIds, params.reader);

  logAudit('messaging_ack', params.messageIds, { reader: params.reader });

  return {
    acknowledged,
    reader: params.reader,
  };
});

// ── messaging_stats (STABLE) ─────────────────────────────────────────────────

registerHandler('messaging_stats', (params: {
  reader?: string;
  channel?: string;
} = {}) => {
  const reader = params.reader || '*';
  const mailbox = getMailbox();
  const stats = mailbox.getStats(reader);

  return {
    reader,
    channel: params.channel || 'all',
    ...stats,
  };
});

// ── messaging_get (STABLE) ───────────────────────────────────────────────────

registerHandler('messaging_get', (params: {
  messageId: string;
}) => {
  if (!params.messageId) {
    throw new Error('Missing required parameter: messageId');
  }

  const mailbox = getMailbox();
  const message = mailbox.getMessage(params.messageId);

  if (!message) {
    return { found: false, messageId: params.messageId };
  }

  return { found: true, message };
});

// ── messaging_update (MUTATION) ──────────────────────────────────────────────

registerHandler('messaging_update', (params: {
  messageId: string;
  body?: string;
  recipients?: string[];
  payload?: Record<string, unknown>;
  persistent?: boolean;
}) => {
  if (!params.messageId) {
    throw new Error('Missing required parameter: messageId');
  }

  const mailbox = getMailbox();
  const updated = mailbox.updateMessage(params.messageId, {
    body: params.body,
    recipients: params.recipients,
    payload: params.payload,
    persistent: params.persistent,
  });

  if (!updated) {
    return { found: false, messageId: params.messageId };
  }

  logAudit('messaging_update', [params.messageId], {
    fields: Object.keys(params).filter(k => k !== 'messageId'),
  });

  return { found: true, message: updated };
});

// ── messaging_purge (MUTATION) ───────────────────────────────────────────────

registerHandler('messaging_purge', (params: {
  channel?: string;
  messageIds?: string[];
  all?: boolean;
} = {}) => {
  const mailbox = getMailbox();
  let removed = 0;
  let action = 'none';

  if (params.all) {
    removed = mailbox.purgeAll();
    action = 'purge_all';
  } else if (params.messageIds?.length) {
    removed = mailbox.deleteMessages(params.messageIds);
    action = 'delete_by_ids';
  } else if (params.channel) {
    removed = mailbox.purgeChannel(params.channel);
    action = 'purge_channel';
  } else {
    removed = mailbox.purgeAll();
    action = 'purge_all';
  }

  logAudit('messaging_purge', [], { action, removed });
  logInfo('[messaging] Messages purged', { action, removed });

  return { action, removed };
});

// ── messaging_reply (MUTATION) ───────────────────────────────────────────────

registerHandler('messaging_reply', async (params: {
  parentId: string;
  sender: string;
  body: string;
  replyAll?: boolean;
  recipients?: string[];
  priority?: string;
  tags?: string[];
  persistent?: boolean;
  payload?: Record<string, unknown>;
}) => {
  if (!params.parentId || !params.sender || !params.body) {
    throw new Error('Missing required parameters: parentId, sender, body');
  }

  const mailbox = getMailbox();
  const result = await mailbox.reply(params.parentId, params.sender, params.body, {
    replyAll: params.replyAll,
    recipients: params.recipients,
    priority: params.priority,
    tags: params.tags,
    persistent: params.persistent,
    payload: params.payload,
  });

  logAudit('messaging_reply', [result.messageId], {
    parentId: params.parentId,
    sender: params.sender,
    replyAll: params.replyAll,
  });
  logInfo('[messaging] Reply sent', { messageId: result.messageId, parentId: params.parentId, channel: result.channel });

  return {
    messageId: result.messageId,
    channel: result.channel,
    recipients: result.recipients,
    parentId: params.parentId,
    replyAll: !!params.replyAll,
    status: 'sent',
  };
});

// ── messaging_thread (STABLE) ────────────────────────────────────────────────

registerHandler('messaging_thread', (params: {
  parentId: string;
}) => {
  if (!params.parentId) {
    throw new Error('Missing required parameter: parentId');
  }

  const mailbox = getMailbox();
  const messages = mailbox.getThread(params.parentId);

  return {
    parentId: params.parentId,
    count: messages.length,
    messages,
  };
});
