/**
 * Messaging Routes — Dashboard REST API for inter-agent messaging.
 *
 * Routes:
 *   POST   /api/messages           — send a message
 *   GET    /api/messages/channels   — list channels
 *   GET    /api/messages/stats      — reader stats
 *   GET    /api/messages/:channel   — read messages from channel
 *   POST   /api/messages/ack        — acknowledge messages
 *   GET    /api/messages/by-id/:id  — get message by ID
 *   PUT    /api/messages/by-id/:id  — update message
 *   DELETE /api/messages            — purge messages
 *   POST   /api/messages/inbound    — peer inbound (cross-instance)
 */

import { Router, Request, Response } from 'express';
import { AgentMailbox } from '../../../services/messaging/agentMailbox.js';
import { getRuntimeConfig } from '../../../config/runtimeConfig.js';
import { SendMessageOptionsSchema } from '../../../services/messaging/messagingTypes.js';
import { getWebSocketManager } from '../WebSocketManager.js';
import { dashboardAdminAuth } from './adminAuth.js';

let _mailbox: AgentMailbox | null = null;

function getMailbox(): AgentMailbox {
  if (!_mailbox) {
    _mailbox = new AgentMailbox(getRuntimeConfig().messaging);
  }
  return _mailbox;
}

/** Format Zod issues with field paths for actionable error messages. */
function formatZodIssues(issues: { path: (string | number)[]; message: string; code: string }[]): string[] {
  return issues.map(i => {
    const field = i.path.length ? i.path.join('.') : 'body';
    return `${field}: ${i.message}`;
  });
}

const SEND_SCHEMA_HINT = {
  required: { channel: 'string', sender: 'string', recipients: 'string[]', body: 'string' },
  optional: { priority: 'low|normal|high|critical', ttlSeconds: 'number (1-86400)', persistent: 'boolean', payload: 'object', parentId: 'string', tags: 'string[]', requiresAck: 'boolean', ackBySeconds: 'number' },
};

export function createMessagingRoutes(): Router {
  const router = Router();

  // POST /api/messages — send a message
  router.post('/messages', dashboardAdminAuth, (req: Request, res: Response) => {
    try {
      const parsed = SendMessageOptionsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid message payload',
          issues: formatZodIssues(parsed.error.issues),
          hint: 'POST /api/messages expects a JSON body with required fields: channel, sender, recipients, body',
          schema: SEND_SCHEMA_HINT,
        });
        return;
      }

      const mailbox = getMailbox();
      mailbox.send(parsed.data).then(messageId => {
        try { getWebSocketManager().broadcast({ type: 'message_received', timestamp: Date.now(), data: { messageId, channel: parsed.data.channel } }); } catch { /* ws optional */ }
        res.status(201).json({
          success: true,
          messageId,
          channel: parsed.data.channel,
          status: 'sent',
        });
      }).catch(err => {
        console.error('[Messaging] Send failed:', err);
        res.status(500).json({ success: false, error: 'Send failed' });
      });
    } catch (error) {
      console.error('[Messaging] Failed to send message:', error);
      res.status(500).json({ success: false, error: 'Failed to send message' });
    }
  });

  // GET /api/messages/channels — list all channels
  router.get('/messages/channels', (_req: Request, res: Response) => {
    try {
      const mailbox = getMailbox();
      const channels = mailbox.listChannels();
      res.json({ success: true, count: channels.length, channels });
    } catch (error) {
      console.error('[Messaging] Failed to list channels:', error);
      res.status(500).json({ success: false, error: 'Failed to list channels' });
    }
  });

  // GET /api/messages/stats — reader stats
  router.get('/messages/stats', (req: Request, res: Response) => {
    try {
      const reader = (req.query.reader as string) || '*';
      const mailbox = getMailbox();
      const stats = mailbox.getStats(reader);
      res.json({ success: true, reader, ...stats });
    } catch (error) {
      console.error('[Messaging] Failed to get stats:', error);
      res.status(500).json({ success: false, error: 'Failed to get stats' });
    }
  });

  // GET /api/messages/by-id/:id — get message by ID
  router.get('/messages/by-id/:id', (req: Request, res: Response) => {
    try {
      const mailbox = getMailbox();
      const message = mailbox.getMessage(req.params.id);
      if (!message) {
        res.status(404).json({ success: false, error: `Message not found: ${req.params.id}`, hint: 'Use GET /api/messages/channels to list channels, then GET /api/messages/:channel to browse messages' });
        return;
      }
      res.json({ success: true, message });
    } catch (error) {
      console.error('[Messaging] Failed to get message:', error);
      res.status(500).json({ success: false, error: 'Failed to get message' });
    }
  });

  // PUT /api/messages/by-id/:id — update message
  router.put('/messages/by-id/:id', dashboardAdminAuth, (req: Request, res: Response) => {
    try {
      const mailbox = getMailbox();
      const updated = mailbox.updateMessage(req.params.id, {
        body: req.body.body,
        recipients: req.body.recipients,
        payload: req.body.payload,
        persistent: req.body.persistent,
      });
      if (!updated) {
        res.status(404).json({ success: false, error: `Message not found: ${req.params.id}`, hint: 'Use GET /api/messages/by-id/:id to verify the message exists before updating' });
        return;
      }
      try { getWebSocketManager().broadcast({ type: 'message_received', timestamp: Date.now(), data: { messageId: req.params.id } }); } catch { /* ws optional */ }
      res.json({ success: true, message: updated });
    } catch (error) {
      console.error('[Messaging] Failed to update message:', error);
      res.status(500).json({ success: false, error: 'Failed to update message' });
    }
  });

  // GET /api/messages/thread/:parentId — get full thread
  router.get('/messages/thread/:parentId', (req: Request, res: Response) => {
    try {
      const parentId = decodeURIComponent(req.params.parentId);
      const mailbox = getMailbox();
      const thread = mailbox.getThread(parentId);
      if (!thread || thread.length === 0) {
        res.status(404).json({ success: false, error: `No thread found for parentId: ${parentId}` });
        return;
      }
      res.json({ success: true, parentId, count: thread.length, messages: thread });
    } catch (error) {
      console.error('[Messaging] Failed to get thread:', error);
      res.status(500).json({ success: false, error: 'Failed to get thread' });
    }
  });

  // GET /api/messages/:channel — read messages from channel
  router.get('/messages/:channel', (req: Request, res: Response) => {
    try {
      const channel = decodeURIComponent(req.params.channel);
      const reader = (req.query.reader as string) || '*';
      const unreadOnly = req.query.unreadOnly === 'true';
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const markRead = req.query.markRead === 'true';
      const tags = req.query.tags ? (req.query.tags as string).split(',').map(t => t.trim()).filter(Boolean) : undefined;
      const sender = (req.query.sender as string) || undefined;

      const mailbox = getMailbox();
      const messages = mailbox.read({ channel, reader, unreadOnly, limit, markRead, tags, sender });
      res.json({ success: true, channel, reader, count: messages.length, messages });
    } catch (error) {
      console.error('[Messaging] Failed to read messages:', error);
      res.status(500).json({ success: false, error: 'Failed to read messages' });
    }
  });

  // POST /api/messages/ack — acknowledge messages
  router.post('/messages/ack', dashboardAdminAuth, (req: Request, res: Response) => {
    try {
      const { messageIds, reader } = req.body;
      if (!Array.isArray(messageIds) || !reader) {
        res.status(400).json({
          success: false,
          error: 'Invalid ack request',
          issues: [
            ...(!Array.isArray(messageIds) ? ['messageIds: must be a non-empty array of message ID strings'] : []),
            ...(!reader ? ['reader: must be a non-empty string identifying the acknowledging agent'] : []),
          ],
          hint: 'POST /api/messages/ack expects { "messageIds": ["msg-..."], "reader": "agent-name" }',
        });
        return;
      }
      const mailbox = getMailbox();
      const acknowledged = mailbox.ack(messageIds, reader);
      res.json({ success: true, acknowledged, reader });
    } catch (error) {
      console.error('[Messaging] Failed to acknowledge messages:', error);
      res.status(500).json({ success: false, error: 'Failed to acknowledge messages' });
    }
  });

  // DELETE /api/messages — purge messages
  router.delete('/messages', dashboardAdminAuth, (req: Request, res: Response) => {
    try {
      const mailbox = getMailbox();
      let removed = 0;
      let action: string;

      if (req.body?.messageIds?.length) {
        removed = mailbox.deleteMessages(req.body.messageIds);
        action = 'delete_by_ids';
      } else if (req.body?.channel) {
        removed = mailbox.purgeChannel(req.body.channel);
        action = 'purge_channel';
      } else {
        removed = mailbox.purgeAll();
        action = 'purge_all';
      }

      try { getWebSocketManager().broadcast({ type: 'message_purged', timestamp: Date.now(), data: { count: removed } }); } catch { /* ws optional */ }
      res.json({ success: true, action, purged: removed });
    } catch (error) {
      console.error('[Messaging] Failed to purge messages:', error);
      res.status(500).json({ success: false, error: 'Failed to purge messages' });
    }
  });

  // POST /api/messages/inbound — receive message from peer instance
  router.post('/messages/inbound', dashboardAdminAuth, (req: Request, res: Response) => {
    try {
      if (!req.body || !req.body.id || !req.body.channel) {
        res.status(400).json({
          success: false,
          error: 'Invalid inbound message',
          issues: [
            ...(!req.body?.id ? ['id: required — unique message identifier'] : []),
            ...(!req.body?.channel ? ['channel: required — target channel name'] : []),
          ],
          hint: 'POST /api/messages/inbound expects { "id": "...", "channel": "...", "sender": "...", "body": "..." }',
        });
        return;
      }
      const mailbox = getMailbox();
      mailbox.send({
        channel: req.body.channel,
        sender: req.body.sender || 'peer',
        recipients: req.body.recipients || ['*'],
        body: req.body.body || '',
        ttlSeconds: req.body.ttlSeconds,
        persistent: req.body.persistent,
        payload: req.body.payload,
        priority: req.body.priority,
        parentId: req.body.parentId,
        tags: req.body.tags,
      }).then(() => {
        try { getWebSocketManager().broadcast({ type: 'message_received', timestamp: Date.now(), data: { channel: req.body.channel } }); } catch { /* ws optional */ }
        res.json({ success: true, status: 'received' });
      }).catch(err => {
        console.error('[Messaging] Inbound failed:', err);
        res.status(500).json({ success: false, error: 'Inbound failed' });
      });
    } catch (error) {
      console.error('[Messaging] Failed to process inbound message:', error);
      res.status(500).json({ success: false, error: 'Failed to process inbound message' });
    }
  });

  // POST /api/messages/reply — reply to a message
  router.post('/messages/reply', dashboardAdminAuth, async (req: Request, res: Response) => {
    try {
      const { parentId, sender, body, replyAll, recipients, priority, tags, persistent, payload } = req.body || {};
      if (!parentId || !sender || !body) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: parentId, sender, body',
          hint: 'POST /api/messages/reply expects { "parentId": "...", "sender": "...", "body": "...", "replyAll": false }',
        });
        return;
      }
      const mailbox = getMailbox();
      const result = await mailbox.reply(parentId, sender, body, { replyAll, recipients, priority, tags, persistent, payload });
      try { getWebSocketManager().broadcast({ type: 'message_received', timestamp: Date.now(), data: { channel: result.channel } }); } catch { /* ws optional */ }
      res.json({ success: true, message: result });
    } catch (error) {
      console.error('[Messaging] Failed to reply to message:', error);
      const isNotFound = error instanceof Error && error.message.includes('not found');
      const status = isNotFound ? 404 : 500;
      res.status(status).json({ success: false, error: isNotFound ? 'Parent message not found' : 'Failed to reply to message' });
    }
  });

  return router;
}
