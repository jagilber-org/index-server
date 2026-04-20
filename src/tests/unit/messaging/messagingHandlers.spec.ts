/**
 * Unit tests for MCP messaging tool handlers.
 * TDD Phase: RED → GREEN
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Force mutation enabled for handler tests
process.env.INDEX_SERVER_MUTATION = '1';

import { getHandler } from '../../../server/registry';

// Import handlers to trigger registration
import '../../../services/handlers.messaging';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'handler-msg-'));
}

describe('Messaging Handlers (MCP Tools)', () => {
  let tmpDir: string;
  const originalDir = process.env.INDEX_SERVER_MESSAGING_DIR;

  beforeEach(() => {
    tmpDir = makeTempDir();
    process.env.INDEX_SERVER_MESSAGING_DIR = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalDir) {
      process.env.INDEX_SERVER_MESSAGING_DIR = originalDir;
    } else {
      delete process.env.INDEX_SERVER_MESSAGING_DIR;
    }
  });

  describe('messaging_send', () => {
    it('is registered as a handler', () => {
      expect(getHandler('messaging_send')).toBeDefined();
    });

    it('sends a message and returns ID', async () => {
      const handler = getHandler('messaging_send')!;
      const result = await handler({
        channel: 'test',
        sender: 'agent-a',
        recipients: ['*'],
        body: 'Hello from handler',
      });
      expect(result).toBeDefined();
      const parsed = typeof result === 'string' ? JSON.parse(result) : result;
      const content = parsed.content?.[0]?.text ? JSON.parse(parsed.content[0].text) : parsed;
      expect(content.messageId || content.id).toBeTruthy();
    });
  });

  describe('messaging_read', () => {
    it('is registered as a handler', () => {
      expect(getHandler('messaging_read')).toBeDefined();
    });
  });

  describe('messaging_list_channels', () => {
    it('is registered as a handler', () => {
      expect(getHandler('messaging_list_channels')).toBeDefined();
    });
  });

  describe('messaging_ack', () => {
    it('is registered as a handler', () => {
      expect(getHandler('messaging_ack')).toBeDefined();
    });
  });

  describe('messaging_stats', () => {
    it('is registered as a handler', () => {
      expect(getHandler('messaging_stats')).toBeDefined();
    });
  });

  describe('messaging_get', () => {
    it('is registered as a handler', () => {
      expect(getHandler('messaging_get')).toBeDefined();
    });
  });

  describe('messaging_update', () => {
    it('is registered as a handler', () => {
      expect(getHandler('messaging_update')).toBeDefined();
    });
  });

  describe('messaging_purge', () => {
    it('is registered as a handler', () => {
      expect(getHandler('messaging_purge')).toBeDefined();
    });
  });
});
