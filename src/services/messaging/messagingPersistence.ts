/**
 * JSONL-based messaging persistence.
 *
 * Stores messages one-per-line in `messages.jsonl`. Provides append, load,
 * and rewrite operations with deduplication and corruption tolerance.
 *
 * Follows the atomic write pattern from `atomicFs.ts` for rewrite operations.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type { AgentMessage } from './messagingTypes';

const FILENAME = 'messages.jsonl';
const VERSION_FILENAME = '.messages-version';

/** Track appended IDs per directory to prevent cross-process duplicates within a session. */
const appendedIds = new Map<string, Set<string>>();

/** Returns the path to messages.jsonl in the given directory. */
export function getMessagingFilePath(dir: string): string {
  return path.join(dir, FILENAME);
}

/** Returns the path to the messaging version token file in the given directory. */
export function getMessagingVersionFilePath(dir: string): string {
  return path.join(dir, VERSION_FILENAME);
}

/** Touch the messaging version token after a successful on-disk mutation. */
export function touchMessagesVersion(dir: string): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(getMessagingVersionFilePath(dir), token, 'utf8');
  } catch {
    // Best-effort cache invalidation only; readers still fall back to file or
    // directory mtimes when the version token cannot be written.
  }
}

/** Read the messaging version marker mtime with safe fallbacks for legacy dirs. */
export function readMessagesVersionMTime(dir: string): number {
  try {
    const versionFilePath = getMessagingVersionFilePath(dir);
    if (fs.existsSync(versionFilePath)) {
      return fs.statSync(versionFilePath).mtimeMs || 0;
    }
  } catch {
    // Ignore version-token stat failures and fall back to the message file.
  }

  try {
    const filePath = getMessagingFilePath(dir);
    if (fs.existsSync(filePath)) {
      return fs.statSync(filePath).mtimeMs || 0;
    }
  } catch {
    // Ignore message-file stat failures and fall back to the directory.
  }

  try {
    if (fs.existsSync(dir)) {
      return fs.statSync(dir).mtimeMs || 0;
    }
  } catch {
    // Ignore missing or unreadable directories and return the empty-state token.
  }

  return 0;
}

/** Read the current messaging version token. Returns empty string when absent. */
export function readMessagesVersionToken(dir: string): string {
  try {
    const versionFilePath = getMessagingVersionFilePath(dir);
    if (fs.existsSync(versionFilePath)) {
      return fs.readFileSync(versionFilePath, 'utf8').trim();
    }
  } catch {
    // Ignore token read failures; callers use mtime fallback plus empty token.
  }

  return '';
}

/**
 * Append a single message to the JSONL file.
 * Deduplicates by message ID within this process session.
 */
export function appendMessage(msg: AgentMessage, dir: string): void {
  if (!appendedIds.has(dir)) appendedIds.set(dir, new Set());
  const seen = appendedIds.get(dir)!;
  if (seen.has(msg.id)) return;

  const filePath = getMessagingFilePath(dir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.appendFileSync(filePath, JSON.stringify(msg) + os.EOL, 'utf8'); // lgtm[js/http-to-file-access] — persistence path from config
  seen.add(msg.id);
  touchMessagesVersion(dir);
}

/**
 * Load all messages from the JSONL file.
 * Skips corrupt/empty lines and deduplicates by ID.
 */
export function loadMessages(dir: string): AgentMessage[] {
  const filePath = getMessagingFilePath(dir);
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const messages: AgentMessage[] = [];
  const seenIds = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed) as AgentMessage;
      if (msg.id && !seenIds.has(msg.id)) {
        seenIds.add(msg.id);
        messages.push(msg);
      }
    } catch {
      // Skip corrupt lines (DI-2: graceful corruption handling)
    }
  }

  // Seed the append dedup set so we don't re-append loaded messages
  if (!appendedIds.has(dir)) appendedIds.set(dir, new Set());
  const seen = appendedIds.get(dir)!;
  for (const msg of messages) seen.add(msg.id);

  return messages;
}

/**
 * Rewrite the JSONL file with the provided messages (atomic via temp+rename).
 * Used after TTL sweep or purge operations.
 */
export function rewriteMessages(messages: AgentMessage[], dir: string): void {
  const filePath = getMessagingFilePath(dir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const data = messages.map(m => JSON.stringify(m)).join(os.EOL) + (messages.length ? os.EOL : '');
  const tmp = path.join(dir, `.${path.basename(filePath)}.${crypto.randomBytes(6).toString('hex')}.tmp`);

  try {
    fs.writeFileSync(tmp, data, 'utf8');
    fs.renameSync(tmp, filePath);
  } catch {
    // Fallback: direct write if rename fails (Windows/network FS)
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
    fs.writeFileSync(filePath, data, 'utf8');
  }

  // Reset dedup set to match current state
  const seen = new Set(messages.map(m => m.id));
  appendedIds.set(dir, seen);
  touchMessagesVersion(dir);
}

/** Reset dedup state (for testing). */
export function _resetDedupState(): void {
  appendedIds.clear();
}
