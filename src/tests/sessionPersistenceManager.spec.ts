import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reloadRuntimeConfig } from '../config/runtimeConfig';
import { SessionPersistenceManager } from '../dashboard/server/SessionPersistenceManager';
import type { SessionPersistenceData } from '../models/SessionPersistence';

function buildData(sessionId: string): SessionPersistenceData {
  return {
    adminSessions: [
      {
        id: sessionId,
        userId: 'dashboard_auto',
        startTime: '2026-04-10T00:00:00.000Z',
        lastActivity: '2026-04-10T00:00:00.000Z',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        permissions: ['read', 'write', 'admin'],
        persistedAt: '2026-04-10T00:00:00.000Z',
        version: 1,
      },
    ],
    webSocketConnections: [],
    sessionHistory: [],
    metadata: {
      lastPersisted: '2026-04-10T00:00:00.000Z',
      version: 1,
      totalSessions: 1,
      totalConnections: 0,
      totalHistoryEntries: 0,
      checksums: {
        sessions: '',
        connections: '',
        history: '',
      },
    },
  };
}

describe('SessionPersistenceManager', () => {
  const previousEnabled = process.env.INDEX_SERVER_SESSION_PERSISTENCE_ENABLED;
  const previousDir = process.env.INDEX_SERVER_SESSION_PERSISTENCE_DIR;
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-persistence-'));
    process.env.INDEX_SERVER_SESSION_PERSISTENCE_ENABLED = '1';
    process.env.INDEX_SERVER_SESSION_PERSISTENCE_DIR = tmpDir;
    reloadRuntimeConfig();
  });

  afterEach(() => {
    if (previousEnabled === undefined) delete process.env.INDEX_SERVER_SESSION_PERSISTENCE_ENABLED;
    else process.env.INDEX_SERVER_SESSION_PERSISTENCE_ENABLED = previousEnabled;
    if (previousDir === undefined) delete process.env.INDEX_SERVER_SESSION_PERSISTENCE_DIR;
    else process.env.INDEX_SERVER_SESSION_PERSISTENCE_DIR = previousDir;
    reloadRuntimeConfig();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('recovers from malformed persisted admin sessions JSON', async () => {
    const sessionsDir = path.join(tmpDir, 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    fs.writeFileSync(path.join(sessionsDir, 'session-manifest.json'), JSON.stringify({
      metadata: buildData('seed').metadata,
      files: {
        adminSessions: 'admin-sessions.json',
        webSocketConnections: 'websocket-connections.json',
        sessionHistory: 'session-history.json',
      },
      retention: {
        maxHistoryEntries: 1000,
        maxHistoryDays: 30,
        maxConnectionHistoryDays: 7,
      },
    }, null, 2));
    fs.writeFileSync(path.join(sessionsDir, 'admin-sessions.json'), '[]  {"id":"broken"}\n]');
    fs.writeFileSync(path.join(sessionsDir, 'websocket-connections.json'), '[]');
    fs.writeFileSync(path.join(sessionsDir, 'session-history.json'), '[]');
    fs.writeFileSync(path.join(sessionsDir, 'session-metadata.json'), JSON.stringify(buildData('seed').metadata, null, 2));

    const manager = new SessionPersistenceManager();
    const data = await manager.loadData();

    expect(data).not.toBeNull();
    expect(data!.adminSessions).toEqual([]);

    const archived = fs.readdirSync(sessionsDir).some((name) => name.startsWith('admin-sessions.json.corrupt-'));
    expect(archived).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(sessionsDir, 'admin-sessions.json'), 'utf8'))).toEqual([]);
  });

  it('keeps persisted files valid under overlapping writes', async () => {
    const managerA = new SessionPersistenceManager();
    const managerB = new SessionPersistenceManager();

    await Promise.all([
      managerA.persistData(buildData('admin-a')),
      managerB.persistData(buildData('admin-b')),
      managerA.persistData(buildData('admin-c')),
      managerB.persistData(buildData('admin-d')),
    ]);

    const sessionsDir = path.join(tmpDir, 'sessions');
    const files = [
      'admin-sessions.json',
      'websocket-connections.json',
      'session-history.json',
      'session-metadata.json',
      'session-manifest.json',
    ];

    for (const file of files) {
      const raw = fs.readFileSync(path.join(sessionsDir, file), 'utf8');
      expect(() => JSON.parse(raw)).not.toThrow();
    }
  });
});
