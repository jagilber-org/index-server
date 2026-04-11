/**
 * AdminPanelState — Session state management logic.
 *
 * Manages active admin sessions and session history, including
 * persistence, creation, termination, and cleanup of expired sessions.
 */

import { getRuntimeConfig } from '../../config/runtimeConfig';
import { SessionPersistenceManager } from './SessionPersistenceManager';
import {
  PersistedAdminSession,
  PersistedSessionHistoryEntry
} from '../../models/SessionPersistence';

export interface AdminSession {
  id: string;
  userId: string;
  startTime: Date;
  lastActivity: Date;
  ipAddress: string;
  userAgent: string;
  permissions: string[];
}

export interface AdminSessionHistoryEntry {
  id: string;
  userId: string;
  startTime: Date;
  endTime?: Date;
  ipAddress: string;
  userAgent: string;
  terminated?: boolean;
  terminationReason?: string;
}

export class AdminPanelState {
  readonly activeSessions: Map<string, AdminSession> = new Map();
  private sessionHistory: AdminSessionHistoryEntry[] = [];
  private sessionHistoryIndex: Map<string, AdminSessionHistoryEntry> = new Map();
  private persistenceManager: SessionPersistenceManager;

  private get maxSessionHistory(): number {
    const value = getRuntimeConfig().dashboard.admin.maxSessionHistory;
    return Number.isFinite(value) ? value : 200;
  }

  constructor() {
    this.persistenceManager = new SessionPersistenceManager();
    this.initializePersistence();
  }

  async initializePersistence(): Promise<void> {
    try {
      const persistedData = await this.persistenceManager.loadData();
      if (persistedData) {
        this.activeSessions.clear();
        persistedData.adminSessions.forEach(persistedSession => {
          const adminSession: AdminSession = {
            id: persistedSession.id,
            userId: persistedSession.userId,
            startTime: new Date(persistedSession.startTime),
            lastActivity: new Date(persistedSession.lastActivity),
            ipAddress: persistedSession.ipAddress,
            userAgent: persistedSession.userAgent,
            permissions: persistedSession.permissions
          };
          this.activeSessions.set(adminSession.id, adminSession);
        });

        this.sessionHistory = [];
        this.sessionHistoryIndex.clear();
        persistedData.sessionHistory.forEach(persistedEntry => {
          const historyEntry: AdminSessionHistoryEntry = {
            id: persistedEntry.id,
            userId: persistedEntry.userId,
            startTime: new Date(persistedEntry.startTime),
            endTime: persistedEntry.endTime ? new Date(persistedEntry.endTime) : undefined,
            ipAddress: persistedEntry.ipAddress,
            userAgent: persistedEntry.userAgent,
            terminated: persistedEntry.terminated,
            terminationReason: persistedEntry.terminationReason
          };
          this.sessionHistory.push(historyEntry);
          this.sessionHistoryIndex.set(historyEntry.id, historyEntry);
        });

        console.log(`Loaded ${this.activeSessions.size} active sessions and ${this.sessionHistory.length} history entries from persistence`);
      }
    } catch (error) {
      console.error('Failed to initialize session persistence:', error);
    }
  }

  async persistSessionState(): Promise<void> {
    try {
      const adminSessions: PersistedAdminSession[] = Array.from(this.activeSessions.values()).map(session => ({
        id: session.id,
        userId: session.userId,
        startTime: session.startTime.toISOString(),
        lastActivity: session.lastActivity.toISOString(),
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        permissions: session.permissions,
        persistedAt: new Date().toISOString(),
        version: 1
      }));

      const sessionHistory: PersistedSessionHistoryEntry[] = this.sessionHistory.map(entry => ({
        id: entry.id,
        userId: entry.userId,
        startTime: entry.startTime.toISOString(),
        endTime: entry.endTime?.toISOString(),
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        terminated: entry.terminated,
        terminationReason: entry.terminationReason,
        persistedAt: new Date().toISOString(),
        version: 1
      }));

      const persistedData = {
        adminSessions,
        webSocketConnections: [],
        sessionHistory,
        metadata: {
          lastPersisted: new Date().toISOString(),
          version: 1,
          totalSessions: adminSessions.length,
          totalConnections: 0,
          totalHistoryEntries: sessionHistory.length,
          checksums: { sessions: '', connections: '', history: '' }
        }
      };

      await this.persistenceManager.persistData(persistedData);
    } catch (error) {
      console.error('Failed to persist session state:', error);
    }
  }

  getActiveSessions(sessionTimeout: number): AdminSession[] {
    this.cleanupExpiredSessions(sessionTimeout);
    return Array.from(this.activeSessions.values());
  }

  createAdminSession(userId: string, ipAddress: string, userAgent: string): AdminSession {
    const session: AdminSession = {
      id: this.generateSessionId(),
      userId,
      startTime: new Date(),
      lastActivity: new Date(),
      ipAddress,
      userAgent,
      permissions: ['read', 'write', 'admin']
    };

    this.activeSessions.set(session.id, session);
    const hist: AdminSessionHistoryEntry = {
      id: session.id,
      userId: session.userId,
      startTime: session.startTime,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent
    };
    this.sessionHistory.unshift(hist);
    this.sessionHistoryIndex.set(hist.id, hist);
    if (this.sessionHistory.length > this.maxSessionHistory) {
      const removed = this.sessionHistory.pop();
      if (removed) this.sessionHistoryIndex.delete(removed.id);
    }

    this.persistSessionState().catch(error => {
      console.error('Failed to persist session state after creation:', error);
    });

    return session;
  }

  terminateSession(sessionId: string): boolean {
    const existed = this.activeSessions.delete(sessionId);
    if (existed) {
      const hist = this.sessionHistoryIndex.get(sessionId);
      if (hist && !hist.terminated) {
        hist.endTime = new Date();
        hist.terminated = true;
        hist.terminationReason = 'manual';
      }

      this.persistSessionState().catch(error => {
        console.error('Failed to persist session state after termination:', error);
      });
    }
    return existed;
  }

  cleanupExpiredSessions(sessionTimeout: number): void {
    const now = new Date();
    let hasChanges = false;

    for (const [id, session] of this.activeSessions.entries()) {
      if (now.getTime() - session.lastActivity.getTime() > sessionTimeout) {
        this.activeSessions.delete(id);
        const hist = this.sessionHistoryIndex.get(id);
        if (hist && !hist.terminated) {
          hist.endTime = new Date();
          hist.terminated = true;
          hist.terminationReason = 'expired';
        }
        hasChanges = true;
      }
    }

    if (hasChanges) {
      this.persistSessionState().catch(error => {
        console.error('Failed to persist session state after cleanup:', error);
      });
    }
  }

  generateSessionId(): string {
    return `admin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getSessionHistory(limit?: number): AdminSessionHistoryEntry[] {
    const slice = typeof limit === 'number' ? this.sessionHistory.slice(0, Math.max(0, limit)) : this.sessionHistory;
    return slice.map(h => ({ ...h }));
  }

  async clearSessionHistory(): Promise<{ success: boolean; message: string; clearedCount: number }> {
    try {
      const clearedCount = this.sessionHistory.length;
      this.sessionHistory = [];
      this.sessionHistoryIndex.clear();
      await this.persistSessionState();
      return { success: true, message: `Successfully cleared ${clearedCount} session history entries`, clearedCount };
    } catch (error) {
      return {
        success: false,
        message: `Failed to clear session history: ${error instanceof Error ? error.message : String(error)}`,
        clearedCount: 0
      };
    }
  }

  updateSessionActivity(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
      this.persistSessionState().catch(error => {
        console.error('Failed to persist session activity update:', error);
      });
      return true;
    }
    return false;
  }
}
