/**
 * Unit tests for JSONL messaging persistence.
 * TDD Phase: RED → GREEN
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  appendMessage,
  loadMessages,
  rewriteMessages,
  getMessagingFilePath,
} from '../../../services/messaging/messagingPersistence';
import type { AgentMessage } from '../../../services/messaging/messagingTypes';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'msg-test-'));
}

function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: `msg-1-${Date.now()}`,
    channel: 'general',
    sender: 'agent-a',
    recipients: ['*'],
    body: 'Test message',
    createdAt: new Date().toISOString(),
    ttlSeconds: 3600,
    ...overrides,
  };
}

describe('Messaging Persistence (JSONL)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getMessagingFilePath', () => {
    it('returns path to messages.jsonl in given dir', () => {
      const result = getMessagingFilePath(tmpDir);
      expect(result).toBe(path.join(tmpDir, 'messages.jsonl'));
    });
  });

  describe('appendMessage', () => {
    it('creates file and appends single message', () => {
      const msg = makeMessage();
      appendMessage(msg, tmpDir);

      const content = fs.readFileSync(path.join(tmpDir, 'messages.jsonl'), 'utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).id).toBe(msg.id);
    });

    it('appends multiple messages on separate lines', () => {
      const msg1 = makeMessage({ id: 'msg-1' });
      const msg2 = makeMessage({ id: 'msg-2' });
      appendMessage(msg1, tmpDir);
      appendMessage(msg2, tmpDir);

      const content = fs.readFileSync(path.join(tmpDir, 'messages.jsonl'), 'utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);
    });

    it('deduplicates by message ID', () => {
      const msg = makeMessage({ id: 'msg-dup' });
      appendMessage(msg, tmpDir);
      appendMessage(msg, tmpDir);

      const content = fs.readFileSync(path.join(tmpDir, 'messages.jsonl'), 'utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);
    });
  });

  describe('loadMessages', () => {
    it('returns empty array when file does not exist', () => {
      const result = loadMessages(tmpDir);
      expect(result).toEqual([]);
    });

    it('loads all messages from JSONL file', () => {
      const msg1 = makeMessage({ id: 'msg-1' });
      const msg2 = makeMessage({ id: 'msg-2' });
      appendMessage(msg1, tmpDir);
      appendMessage(msg2, tmpDir);

      const result = loadMessages(tmpDir);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-1');
      expect(result[1].id).toBe('msg-2');
    });

    it('skips corrupt lines gracefully', () => {
      const filePath = path.join(tmpDir, 'messages.jsonl');
      const msg = makeMessage({ id: 'msg-good' });
      fs.writeFileSync(filePath, JSON.stringify(msg) + '\n{corrupt\n', 'utf8');

      const result = loadMessages(tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg-good');
    });

    it('skips empty lines', () => {
      const filePath = path.join(tmpDir, 'messages.jsonl');
      const msg = makeMessage({ id: 'msg-1' });
      fs.writeFileSync(filePath, '\n' + JSON.stringify(msg) + '\n\n', 'utf8');

      const result = loadMessages(tmpDir);
      expect(result).toHaveLength(1);
    });

    it('deduplicates by ID', () => {
      const filePath = path.join(tmpDir, 'messages.jsonl');
      const msg = makeMessage({ id: 'msg-same' });
      fs.writeFileSync(filePath, JSON.stringify(msg) + '\n' + JSON.stringify(msg) + '\n', 'utf8');

      const result = loadMessages(tmpDir);
      expect(result).toHaveLength(1);
    });
  });

  describe('rewriteMessages', () => {
    it('overwrites file with provided messages', () => {
      const msg1 = makeMessage({ id: 'msg-1' });
      const msg2 = makeMessage({ id: 'msg-2' });
      appendMessage(msg1, tmpDir);
      appendMessage(msg2, tmpDir);

      rewriteMessages([msg2], tmpDir);

      const result = loadMessages(tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg-2');
    });

    it('creates empty file when given empty array', () => {
      rewriteMessages([], tmpDir);

      const filePath = path.join(tmpDir, 'messages.jsonl');
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf8').trim();
      expect(content).toBe('');
    });

    it('handles atomic write on rewrite', () => {
      const msgs = Array.from({ length: 100 }, (_, i) =>
        makeMessage({ id: `msg-${i}` })
      );
      rewriteMessages(msgs, tmpDir);

      const result = loadMessages(tmpDir);
      expect(result).toHaveLength(100);
    });
  });
});
