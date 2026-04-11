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

/** Track appended IDs per directory to prevent cross-process duplicates within a session. */
const appendedIds = new Map<string, Set<string>>();

/** Returns the path to messages.jsonl in the given directory. */
export function getMessagingFilePath(dir: string): string {
  return path.join(dir, FILENAME);
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

  fs.appendFileSync(filePath, JSON.stringify(msg) + os.EOL, 'utf8');
  seen.add(msg.id);
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
}

/** Reset dedup state (for testing). */
export function _resetDedupState(): void {
  appendedIds.clear();
}
