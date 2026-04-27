import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { logError } from './logger.js';

export type TraceLevel = 0|1|2|3|4;

export interface TraceRecord {
  ts: string;
  t: number;
  lvl: TraceLevel;
  label: string;
  data?: unknown;
  func?: string;
  pid: number;
  session: string;
}

let cachedLevel: TraceLevel = 0;
let lastLevelCheck = 0;
let traceStream: fs.WriteStream | null = null;
let traceFilePath: string | null = null;
let traceBytesWritten = 0;
let rotationIndex = 0;
let cachedSessionId: string | null = null;
let maxFileSize = 0;
const traceBuffer: TraceRecord[] = [];
let bufferExitHookRegistered = false;

function computeTraceLevel(): TraceLevel {
  const cfg = getRuntimeConfig();
  const tracing = cfg.tracing;
  const traceTokens = cfg.trace;
  let level: TraceLevel;
  switch (tracing.level) {
    case 'verbose': level = 4; break;
    case 'trace': level = 3; break;
    case 'debug': level = 2; break;
    case 'info':
    case 'warn':
    case 'error':
      level = 1; break;
    default:
      level = 0;
  }
  if (traceTokens.has('traceAll')) level = 4;
  if (cfg.index.fileTrace) level = Math.max(level, 3) as TraceLevel;
  if (traceTokens.has('visibilityDiag')) level = Math.max(level, 1) as TraceLevel;
  if (level === 0 && (tracing.persist || tracing.file)) level = 1;
  return level;
}

export function currentTraceLevel(): TraceLevel {
  const now = Date.now();
  if (now - lastLevelCheck > 1500) {
    cachedLevel = computeTraceLevel();
    lastLevelCheck = now;
  }
  return cachedLevel;
}

export function traceEnabled(min: TraceLevel = 1): boolean {
  return currentTraceLevel() >= min;
}

function resolveSessionId(): string {
  if (cachedSessionId) return cachedSessionId;
  const tracing = getRuntimeConfig().tracing;
  const provided = tracing.sessionId && tracing.sessionId.trim().length ? tracing.sessionId.trim() : undefined;
  cachedSessionId = provided || crypto.randomBytes(4).toString('hex');
  return cachedSessionId;
}

function categoriesAllow(label: string, categories: Set<string>): boolean {
  if (!categories.size) return true;
  const tokens = label
    .replace(/^\[/, '')
    .replace(/]$/, '')
    .split(':')
    .map(s => s.replace(/^trace/, '').trim())
    .filter(Boolean);
  for (const token of tokens) {
    if (categories.has(token)) return true;
  }
  return false;
}

function ensureTraceStream(tracingCfg: ReturnType<typeof getRuntimeConfig>['tracing']): void {
  if (traceStream) return;
  let file = tracingCfg.file;
  if (!file && tracingCfg.persist) {
    const dir = tracingCfg.dir || path.join(process.cwd(), 'logs', 'trace');
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    file = path.join(dir, `trace-${stamp}.jsonl`);
  }
  if (!file) return;
  try {
    traceStream = fs.createWriteStream(file, { flags: 'a' });
    traceFilePath = file;
    traceBytesWritten = 0;
    rotationIndex = 0;
    maxFileSize = tracingCfg.maxFileSizeBytes || 0;
  } catch {
    traceStream = null;
    traceFilePath = null;
    traceBytesWritten = 0;
    rotationIndex = 0;
    maxFileSize = 0;
  }
}

function rotateIfNeeded(): void {
  if (!traceStream || !traceFilePath) return;
  if (!maxFileSize || traceBytesWritten < maxFileSize) return;
  try { traceStream.end(); } catch { /* ignore */ }
  rotationIndex += 1;
  const base = traceFilePath.replace(/\.jsonl$/, '');
  const rotated = `${base}.${rotationIndex}.jsonl`;
  try {
    traceStream = fs.createWriteStream(rotated, { flags: 'a' });
    traceFilePath = rotated;
    traceBytesWritten = 0;
  } catch {
    traceStream = null;
    traceFilePath = null;
    traceBytesWritten = 0;
  }
}

function resolveCaller(callsiteEnabled: boolean): string | undefined {
  if (!callsiteEnabled && currentTraceLevel() < 4) return undefined;
  const err = new Error();
  if (!err.stack) return undefined;
  const frames = err.stack.split('\n').slice(3);
  for (const frame of frames) {
    const match = frame.match(/at\s+([^\s(]+)/);
    if (match && match[1] && match[1] !== 'Object.emitTrace') return match[1];
  }
  return undefined;
}

function defaultBufferFile(): string {
  return path.join(process.cwd(), 'logs', 'trace', 'trace-buffer.json');
}

function ensureBufferExitHook(bufferCfg: ReturnType<typeof getRuntimeConfig>['tracing']['buffer']): void {
  if (bufferExitHookRegistered) return;
  if (bufferCfg.sizeBytes && (bufferCfg.dumpOnExit || bufferCfg.file)) {
    bufferExitHookRegistered = true;
    try { process.on('exit', () => dumpTraceBuffer()); } catch { /* ignore */ }
  }
}

function pushBuffer(rec: TraceRecord, bufferCfg: ReturnType<typeof getRuntimeConfig>['tracing']['buffer']): void {
  ensureBufferExitHook(bufferCfg);
  const size = bufferCfg.sizeBytes;
  if (!size) return;
  traceBuffer.push(rec);
  if (traceBuffer.length > size) traceBuffer.splice(0, traceBuffer.length - size);
}

function dumpTraceBuffer(file?: string): void {
  const bufferCfg = getRuntimeConfig().tracing.buffer;
  if (!bufferCfg.sizeBytes || !traceBuffer.length) return;
  const target = file || bufferCfg.file || defaultBufferFile();
  try {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ size: traceBuffer.length, records: traceBuffer }, null, 2));
  } catch { /* ignore */ }
}

export function getTraceBuffer(): TraceRecord[] { return traceBuffer.slice(); }
export function dumpTraceBufferNow(target?: string): void { dumpTraceBuffer(target); }

export function emitTrace(label: string, data: unknown, min: TraceLevel = 1): void {
  const cfg = getRuntimeConfig();
  const tracing = cfg.tracing;
  if (!traceEnabled(min)) return;
  if (!categoriesAllow(label, tracing.categories)) return;

  const now = Date.now();
  const rec: TraceRecord = {
    ts: new Date(now).toISOString(),
    t: now,
    lvl: currentTraceLevel(),
    label,
    data,
    pid: process.pid,
    session: resolveSessionId(),
  };

  const caller = resolveCaller(tracing.callsite);
  if (caller) rec.func = caller;

  pushBuffer(rec, tracing.buffer);

  try {
    logError(label, JSON.stringify(rec));
  } catch { /* ignore */ }

  if (!(tracing.persist || tracing.file)) return;

  ensureTraceStream(tracing);
  const stream = traceStream;
  if (!stream) return;

  const line = `${label} ${JSON.stringify(rec)}\n`;
  try {
    stream.write(line); // lgtm[js/http-to-file-access] — trace stream targets config-controlled trace file
    traceBytesWritten += Buffer.byteLength(line);
    rotateIfNeeded();
    if (tracing.fsync) {
      const fd = (stream as unknown as { fd?: number }).fd;
      if (typeof fd === 'number' && fd >= 0) {
        try { fs.fsyncSync(fd); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

export function getTraceFile(): string | null { return traceFilePath; }

export interface TraceEnvSummary {
  level: TraceLevel;
  file?: string | null;
  session: string;
  categories?: string[];
  maxFileSize?: number;
  rotationIndex: number;
}

export function summarizeTraceEnv(): TraceEnvSummary {
  const tracing = getRuntimeConfig().tracing;
  const categories = tracing.categories.size ? Array.from(tracing.categories.values()) : undefined;
  return {
    level: currentTraceLevel(),
    file: traceFilePath,
    session: resolveSessionId(),
    categories,
    maxFileSize,
    rotationIndex,
  };
}
