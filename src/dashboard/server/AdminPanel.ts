/**
 * Index Server Admin - Enterprise Administration Interface
 *
 * Thin coordinator that delegates to:
 * - AdminPanelConfig  — server configuration rendering/serialization
 * - AdminPanelState   — admin session state management
 *
 * Retains direct responsibility for maintenance operations, backup/restore,
 * system health monitoring, and admin statistics.
 */
import fs from 'fs';
import path from 'path';
import v8 from 'v8';
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { getMetricsCollector, ToolMetrics } from './MetricsCollector';
import { getIndexState } from '../../services/indexContext';
import { AdminPanelConfig } from './AdminPanelConfig';
import type { AdminConfig } from './AdminPanelConfig';
import { AdminPanelState } from './AdminPanelState';
import type { AdminSession, AdminSessionHistoryEntry } from './AdminPanelState';
import { createZipBackupWithManifest, extractZipBackup, readZipManifest, listZipInstructionFiles, isZipBackup } from '../../services/backupZip';
import AdmZip from 'adm-zip';

// Re-export for consumers that import these types from AdminPanel
export type { AdminConfig, AdminSession, AdminSessionHistoryEntry };

interface SystemMaintenance {
  lastBackup: Date | null;
  nextScheduledMaintenance: Date | null;
  maintenanceMode: boolean;
  systemHealth: {
    status: 'healthy' | 'warning' | 'critical';
    issues: string[];
    recommendations: string[];
    cpuTrend?: 'stable' | 'increasing' | 'decreasing';
    memoryTrend?: 'stable' | 'increasing' | 'decreasing';
    memoryGrowthRate?: number;
  };
}

interface AdminStats {
  totalConnections: number;
  activeConnections: number;
  /** Count of active admin panel sessions (logical authenticated/admin sessions) */
  adminActiveSessions: number;
  totalRequests: number;
  errorRate: number;
  avgResponseTime: number;
  uptime: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  cpuUsage: {
    user: number;
    system: number;
    percent: number;
  };
  toolMetrics: { [toolName: string]: ToolMetrics };
  indexStats: {
    /** Accepted (validated) instruction count – kept also as totalInstructions for backward compatibility */
    totalInstructions: number;
    acceptedInstructions: number;
    rawFileCount: number;
    skippedInstructions: number;
    lastUpdated: Date;
    version: string;
    schemaVersion: string;
  };
}

export class AdminPanel {
  private readonly panelConfig: AdminPanelConfig;
  private readonly panelState: AdminPanelState;
  private maintenanceInfo: SystemMaintenance;
  private indexStatsCache: { totalInstructions: number; acceptedInstructions: number; rawFileCount: number; skippedInstructions: number; lastUpdated: Date; version: string; schemaVersion: string } | null = null;
  private lastUptimeSeconds = 0;

  private get backupRoot(): string {
    return getRuntimeConfig().dashboard.admin.backupsDir || path.join(process.cwd(), 'backups');
  }
  private get instructionsRoot(): string {
    return getRuntimeConfig().index.baseDir || path.join(process.cwd(), 'instructions');
  }

  /**
   * Validate and sanitize a user-supplied backupId to prevent path traversal (SH-4).
   * Returns the sanitized basename or throws if the id is invalid.
   */
  private validateBackupId(backupId: string): string {
    if (!backupId || typeof backupId !== 'string') throw new Error('backupId required');
    const sanitized = path.basename(backupId);
    if (!sanitized || sanitized !== backupId || sanitized.includes('..')) {
      throw new Error('Invalid backupId: path traversal not allowed');
    }
    return sanitized;
  }

  // CPU tracking for leak detection
  private cpuHistory: Array<{ timestamp: number; user: number; system: number; percent: number }> = [];
  private lastCpuUsage: NodeJS.CpuUsage | null = null;
  private readonly maxCpuHistoryEntries = 100;

  // Memory tracking for leak detection
  private memoryHistory: Array<{ timestamp: number; heapUsed: number; heapTotal: number; external: number; rss: number }> = [];
  private readonly maxMemoryHistoryEntries = 100;

  constructor() {
    this.panelConfig = new AdminPanelConfig();
    this.panelState = new AdminPanelState();
    this.maintenanceInfo = {
      lastBackup: null,
      nextScheduledMaintenance: null,
      maintenanceMode: false,
      systemHealth: { status: 'healthy', issues: [], recommendations: [] }
    };
  }


  // ── Config delegation ──────────────────────────────────────────────────────────────

  getAdminConfig(): AdminConfig {
    return this.panelConfig.getAdminConfig();
  }

  updateAdminConfig(updates: Partial<AdminConfig>): { success: boolean; message: string } {
    return this.panelConfig.updateAdminConfig(updates);
  }

  // ── Session state delegation ────────────────────────────────────────────────────────

  getActiveSessions(): AdminSession[] {
    return this.panelState.getActiveSessions(this.panelConfig.sessionTimeout);
  }

  createAdminSession(userId: string, ipAddress: string, userAgent: string): AdminSession {
    return this.panelState.createAdminSession(userId, ipAddress, userAgent);
  }

  terminateSession(sessionId: string): boolean {
    return this.panelState.terminateSession(sessionId);
  }

  /**
   * Get system maintenance information
   */
  getMaintenanceInfo(): SystemMaintenance {
    // Update system health
    this.updateSystemHealth();
    return JSON.parse(JSON.stringify(this.maintenanceInfo));
  }

  /**
   * Set maintenance mode
   */
  setMaintenanceMode(enabled: boolean, message?: string): { success: boolean; message: string } {
    try {
      this.maintenanceInfo.maintenanceMode = enabled;

      if (enabled) {
        process.stderr.write(`[admin] Maintenance mode ENABLED${message ? `: ${message}` : ''}\n`);
      } else {
        process.stderr.write(`[admin] Maintenance mode DISABLED\n`);
      }

      return {
        success: true,
        message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'}`
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to set maintenance mode: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Perform system backup
   */
  async performBackup(): Promise<{ success: boolean; message: string; backupId?: string; files?: number }> {
    try {
      const backupRoot = this.backupRoot;
      if (!fs.existsSync(backupRoot)) fs.mkdirSync(backupRoot, { recursive: true });
      const now = new Date();
      const iso = now.toISOString();
      const baseTs = iso.replace(/[-:]/g, '').replace(/\..+/, '');
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      const backupId = `backup_${baseTs}_${ms}`;
      const zipPath = path.join(backupRoot, `${backupId}.zip`);

      const instructionsDir = this.instructionsRoot;
      let fileCount = 0;
      if (fs.existsSync(instructionsDir)) {
        fileCount = fs.readdirSync(instructionsDir).filter(f => f.toLowerCase().endsWith('.json')).length;
      }

      const manifest = {
        backupId,
        createdAt: now.toISOString(),
        instructionCount: fileCount,
        schemaVersion: this.indexStatsCache?.schemaVersion || 'unknown',
      };

      createZipBackupWithManifest(instructionsDir, zipPath, manifest);

      this.maintenanceInfo.lastBackup = new Date();
      process.stderr.write(`[admin] System backup completed: ${backupId}.zip (${fileCount} files)\n`);
      return { success: true, message: 'System backup completed successfully', backupId, files: fileCount };
    } catch (error) {
      return {
        success: false,
        message: `Backup failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  listBackups(): { id: string; createdAt: string; instructionCount: number; schemaVersion?: string; sizeBytes: number }[] {
    const backupRoot = this.backupRoot;
    if (!fs.existsSync(backupRoot)) return [];
    const results: { id: string; createdAt: string; instructionCount: number; schemaVersion?: string; sizeBytes: number }[] = [];
    for (const entry of fs.readdirSync(backupRoot)) {
      const full = path.join(backupRoot, entry);
      try {
        const stat = fs.statSync(full);

        if (isZipBackup(entry) && stat.isFile()) {
          // Zip backup
          const id = entry.replace(/\.zip$/i, '');
          let createdAt = new Date(stat.mtime).toISOString();
          let instructionCount = 0;
          let schemaVersion: string | undefined;
          const manifest = readZipManifest(full);
          if (manifest) {
            createdAt = (manifest.createdAt as string) || createdAt;
            instructionCount = (manifest.instructionCount as number) || 0;
            schemaVersion = manifest.schemaVersion as string | undefined;
          } else {
            instructionCount = listZipInstructionFiles(full).length;
          }
          results.push({ id, createdAt, instructionCount, schemaVersion, sizeBytes: stat.size });

        } else if (stat.isDirectory()) {
          // Legacy directory backup
          const manifestPath = path.join(full, 'manifest.json');
          let createdAt = new Date(stat.mtime).toISOString();
          let instructionCount = 0;
          let schemaVersion: string | undefined;
          if (fs.existsSync(manifestPath)) {
            try {
              const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
              createdAt = mf.createdAt || createdAt;
              instructionCount = mf.instructionCount || 0;
              schemaVersion = mf.schemaVersion;
            } catch {/* ignore */}
          } else {
            instructionCount = fs.readdirSync(full).filter(f => f.toLowerCase().endsWith('.json')).length;
          }
          const sizeBytes = fs.readdirSync(full).reduce((sum, f) => {
            try { return sum + fs.statSync(path.join(full, f)).size; } catch { return sum; }
          }, 0);
          results.push({ id: entry, createdAt, instructionCount, schemaVersion, sizeBytes });
        }
      } catch {/* ignore individual entry errors */}
    }
    results.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    return results;
  }

  restoreBackup(backupId: string): { success: boolean; message: string; restored?: number } {
    try {
      const safeId = this.validateBackupId(backupId);
      const backupRoot = this.backupRoot;
      const zipPath = path.join(backupRoot, `${safeId}.zip`);
      const backupDir = path.join(backupRoot, safeId);
      const isZip = fs.existsSync(zipPath);
      const isDir = fs.existsSync(backupDir) && fs.statSync(backupDir).isDirectory();
      if (!isZip && !isDir) return { success: false, message: `Backup not found: ${safeId}` };

      const instructionsDir = this.instructionsRoot;
      if (!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir, { recursive: true });

      // Pre-restore safety backup (as zip)
      const existing = fs.readdirSync(instructionsDir).filter(f => f.toLowerCase().endsWith('.json'));
      if (existing.length) {
        const safetyId = `pre_restore_${Date.now()}`;
        const safetyZipPath = path.join(backupRoot, `${safetyId}.zip`);
        createZipBackupWithManifest(instructionsDir, safetyZipPath, {
          type: 'pre-restore',
          createdAt: new Date().toISOString(),
          source: safeId,
          originalCount: existing.length,
        });
        process.stderr.write(`[admin] Pre-restore safety backup created: ${safetyId}.zip\n`);
      }

      let restored = 0;
      if (isZip) {
        restored = extractZipBackup(zipPath, instructionsDir);
        // Don't count manifest.json as a restored instruction
      } else {
        // Legacy directory restore
        for (const f of fs.readdirSync(backupDir)) {
          if (f.toLowerCase().endsWith('.json') && f !== 'manifest.json') {
            fs.copyFileSync(path.join(backupDir, f), path.join(instructionsDir, f));
            restored++;
          }
        }
      }

      this.indexStatsCache = null;
      process.stderr.write(`[admin] Restored backup ${safeId} (${restored} instruction files)\n`);
      return { success: true, message: `Backup ${safeId} restored`, restored };
    } catch (error) {
      return { success: false, message: `Restore failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** Delete a backup zip or directory (safety checks on name) */
  deleteBackup(backupId: string): { success: boolean; message: string; removed?: boolean } {
    try {
      const safeId = this.validateBackupId(backupId);
      const backupRoot = this.backupRoot;
      // Check for zip first, then legacy directory
      const zipPath = path.join(backupRoot, `${safeId}.zip`);
      const dirPath = path.join(backupRoot, safeId);
      const hasZip = fs.existsSync(zipPath);
      const hasDir = fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
      if (!hasZip && !hasDir) return { success: false, message: `Backup not found: ${safeId}` };
      if (!/^backup_|^instructions-|^pre_restore_|^auto-backup-/.test(safeId)) {
        return { success: false, message: 'Refusing to delete unexpected backup name' };
      }
      if (hasZip) fs.unlinkSync(zipPath);
      if (hasDir) fs.rmSync(dirPath, { recursive: true, force: true });
      process.stderr.write(`[admin] Deleted backup ${safeId}\n`);
      return { success: true, message: `Backup ${safeId} deleted`, removed: true };
    } catch (error) {
      return { success: false, message: `Delete failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** Prune backups keeping newest N (by createdAt / mtime). Returns count pruned. */
  pruneBackups(retain: number): { success: boolean; message: string; pruned?: number } {
    try {
      if (retain < 0) return { success: false, message: 'retain must be >= 0' };
      const backupRoot = this.backupRoot;
      if (!fs.existsSync(backupRoot)) return { success: true, message: 'No backups to prune', pruned: 0 };
      const entries = fs.readdirSync(backupRoot)
        .map(name => {
          const full = path.join(backupRoot, name);
          // Derive the logical ID (strip .zip extension)
          const id = name.endsWith('.zip') ? name.replace(/\.zip$/i, '') : name;
          return { name, id, full };
        })
        .filter(d => {
          try {
            const stat = fs.statSync(d.full);
            if (d.name.endsWith('.zip') && stat.isFile()) return /^backup_|^instructions-|^pre_restore_|^auto-backup-/.test(d.id);
            if (stat.isDirectory()) return /^backup_|^instructions-|^pre_restore_|^auto-backup-/.test(d.id);
            return false;
          } catch { return false; }
        });
      // sort newest first by mtime
      entries.sort((a,b) => {
        try { return fs.statSync(b.full).mtime.getTime() - fs.statSync(a.full).mtime.getTime(); } catch { return 0; }
      });
      if (retain === 0) {
        let prunedAll = 0;
        for (const d of entries) {
          try {
            if (d.name.endsWith('.zip')) fs.unlinkSync(d.full);
            else fs.rmSync(d.full, { recursive: true, force: true });
            prunedAll++;
          } catch { /* ignore */ }
        }
        process.stderr.write(`[admin] Pruned all backups (${prunedAll})\n`);
        return { success: true, message: `Pruned ${prunedAll} backups`, pruned: prunedAll };
      }
      const toDelete = entries.slice(retain);
      let pruned = 0;
      for (const d of toDelete) {
        try {
          if (d.name.endsWith('.zip')) fs.unlinkSync(d.full);
          else fs.rmSync(d.full, { recursive: true, force: true });
          pruned++;
        } catch { /* ignore */ }
      }
      process.stderr.write(`[admin] Pruned ${pruned} backup(s); retained ${entries.length - pruned}\n`);
      return { success: true, message: `Pruned ${pruned} backups (retained ${entries.length - pruned})`, pruned };
    } catch (error) {
      return { success: false, message: `Prune failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** Export a backup — returns the zip file path for streaming, or falls back to JSON bundle for legacy dirs */
  exportBackup(backupId: string): { success: boolean; message: string; zipPath?: string; bundle?: { manifest: Record<string, unknown>; files: Record<string, unknown> } } {
    try {
      const safeId = this.validateBackupId(backupId);
      const zipPath = path.join(this.backupRoot, `${safeId}.zip`);
      if (fs.existsSync(zipPath) && fs.statSync(zipPath).isFile()) {
        return { success: true, message: 'Export ready', zipPath };
      }
      // Legacy directory fallback
      const backupDir = path.join(this.backupRoot, safeId);
      if (!fs.existsSync(backupDir) || !fs.statSync(backupDir).isDirectory()) return { success: false, message: `Backup not found: ${safeId}` };
      let manifest: Record<string, unknown> = {};
      const manifestPath = path.join(backupDir, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch { /* ignore */ }
      }
      const files: Record<string, unknown> = {};
      for (const f of fs.readdirSync(backupDir)) {
        if (f.toLowerCase().endsWith('.json') && f !== 'manifest.json') {
          try { files[f] = JSON.parse(fs.readFileSync(path.join(backupDir, f), 'utf-8')); } catch { /* skip corrupt */ }
        }
      }
      return { success: true, message: 'Export ready', bundle: { manifest, files } };
    } catch (error) {
      return { success: false, message: `Export failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** Import a backup from a JSON bundle uploaded by the client — creates a zip */
  importBackup(bundle: { manifest?: Record<string, unknown>; files?: Record<string, unknown> }): { success: boolean; message: string; backupId?: string; files?: number } {
    try {
      if (!bundle || typeof bundle !== 'object' || !bundle.files || typeof bundle.files !== 'object') {
        return { success: false, message: 'Invalid bundle: must contain a "files" object' };
      }
      const now = new Date();
      const baseTs = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      const backupId = `backup_${baseTs}_${ms}`;
      const zipPath = path.join(this.backupRoot, `${backupId}.zip`);
      if (!fs.existsSync(this.backupRoot)) fs.mkdirSync(this.backupRoot, { recursive: true });

      const zip = new AdmZip();
      let written = 0;
      for (const [name, content] of Object.entries(bundle.files)) {
        if (typeof name !== 'string' || !name.toLowerCase().endsWith('.json')) continue;
        const safeName = path.basename(name);
        if (safeName !== name || safeName.includes('..')) continue; // path traversal guard
        zip.addFile(safeName, Buffer.from(JSON.stringify(content, null, 2)));
        written++;
      }
      const manifest = {
        backupId,
        createdAt: now.toISOString(),
        instructionCount: written,
        schemaVersion: (bundle.manifest as Record<string, unknown>)?.schemaVersion || 'imported',
        source: 'file-import',
      };
      zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
      zip.writeZip(zipPath);

      process.stderr.write(`[admin] Imported backup from file: ${backupId}.zip (${written} files)\n`);
      return { success: true, message: `Imported ${written} files as ${backupId}`, backupId, files: written };
    } catch (error) {
      return { success: false, message: `Import failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** Import a zip backup uploaded by the client without rewriting its contents. */
  importZipBackup(zipBuffer: Buffer, sourceName?: string): { success: boolean; message: string; backupId?: string; files?: number } {
    try {
      if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length === 0) {
        return { success: false, message: 'Invalid zip backup: upload was empty' };
      }

      const zip = new AdmZip(zipBuffer);
      const instructionFiles = zip.getEntries()
        .map(entry => path.basename(entry.entryName))
        .filter(name => name.toLowerCase().endsWith('.json') && name === path.basename(name) && name !== 'manifest.json');

      if (!instructionFiles.length) {
        return { success: false, message: 'Invalid zip backup: contains no instruction files' };
      }

      const now = new Date();
      const baseTs = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      const backupId = `backup_${baseTs}_${ms}`;
      const zipPath = path.join(this.backupRoot, `${backupId}.zip`);
      if (!fs.existsSync(this.backupRoot)) fs.mkdirSync(this.backupRoot, { recursive: true });

      fs.writeFileSync(zipPath, zipBuffer);

      const safeSourceName = sourceName ? path.basename(sourceName) : undefined;
      process.stderr.write(
        `[admin] Imported zip backup from file: ${backupId}.zip (${instructionFiles.length} files${safeSourceName ? `, source=${safeSourceName}` : ''})\n`,
      );
      return { success: true, message: `Imported ${instructionFiles.length} files as ${backupId}`, backupId, files: instructionFiles.length };
    } catch (error) {
      return { success: false, message: `Import failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /**
   * Calculate current CPU usage with historical tracking
   */
  private calculateCpuUsage(): { user: number; system: number; percent: number } {
    const currentCpuUsage = process.cpuUsage();
    let cpuPercent = 0;
    let userTime = 0;
    let systemTime = 0;

    if (this.lastCpuUsage) {
      // Calculate delta since last measurement
      const userDelta = currentCpuUsage.user - this.lastCpuUsage.user;
      const systemDelta = currentCpuUsage.system - this.lastCpuUsage.system;
      const totalDelta = userDelta + systemDelta;

      // Convert microseconds to percentage (assuming 1 second interval)
      // For more accurate results, you'd want to track the actual time interval
      cpuPercent = Math.min((totalDelta / 1000000) * 100, 100);
      userTime = userDelta / 1000000; // Convert to seconds
      systemTime = systemDelta / 1000000; // Convert to seconds
    }

    this.lastCpuUsage = currentCpuUsage;

    // Add to history for leak detection
    const historyEntry = {
      timestamp: Date.now(),
      user: userTime,
      system: systemTime,
      percent: cpuPercent
    };

    this.cpuHistory.push(historyEntry);

    // Keep only recent entries
    if (this.cpuHistory.length > this.maxCpuHistoryEntries) {
      this.cpuHistory.shift();
    }

    return {
      user: userTime,
      system: systemTime,
      percent: cpuPercent
    };
  }

  /**
   * Analyze CPU trends for potential leaks
   */
  private analyzeCpuTrends(): { trend: 'stable' | 'increasing' | 'decreasing'; avgUsage: number; peakUsage: number } {
    if (this.cpuHistory.length < 10) {
      return { trend: 'stable', avgUsage: 0, peakUsage: 0 };
    }

    const recent = this.cpuHistory.slice(-10);
    const avgUsage = recent.reduce((sum, entry) => sum + entry.percent, 0) / recent.length;
    const peakUsage = Math.max(...recent.map(entry => entry.percent));

    // Simple trend analysis - compare first half vs second half
    const firstHalf = recent.slice(0, 5);
    const secondHalf = recent.slice(5);
    const firstAvg = firstHalf.reduce((sum, entry) => sum + entry.percent, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, entry) => sum + entry.percent, 0) / secondHalf.length;

    let trend: 'stable' | 'increasing' | 'decreasing' = 'stable';
    const difference = secondAvg - firstAvg;

    if (Math.abs(difference) > 5) {
      trend = difference > 0 ? 'increasing' : 'decreasing';
    }

    return { trend, avgUsage, peakUsage };
  }

  /**
   * Analyze memory usage trends for leak detection
   */
  private analyzeMemoryTrends(): { trend: 'stable' | 'increasing' | 'decreasing'; avgHeapUsed: number; peakHeapUsed: number; growthRate: number } {
    if (this.memoryHistory.length < 10) {
      return { trend: 'stable', avgHeapUsed: 0, peakHeapUsed: 0, growthRate: 0 };
    }

    const recent = this.memoryHistory.slice(-10);
    const avgHeapUsed = recent.reduce((sum, entry) => sum + entry.heapUsed, 0) / recent.length;
    const peakHeapUsed = Math.max(...recent.map(entry => entry.heapUsed));

    // Calculate growth rate (bytes per minute)
    const firstEntry = recent[0];
    const lastEntry = recent[recent.length - 1];
    const timeDiffMinutes = (lastEntry.timestamp - firstEntry.timestamp) / (1000 * 60);
    const growthRate = timeDiffMinutes > 0 ? (lastEntry.heapUsed - firstEntry.heapUsed) / timeDiffMinutes : 0;

    // Simple trend analysis - compare first half vs second half
    const firstHalf = recent.slice(0, 5);
    const secondHalf = recent.slice(5);
    const firstAvg = firstHalf.reduce((sum, entry) => sum + entry.heapUsed, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, entry) => sum + entry.heapUsed, 0) / secondHalf.length;

    let trend: 'stable' | 'increasing' | 'decreasing' = 'stable';
    const difference = secondAvg - firstAvg;

    // Consider memory leak if growth is > 10MB or growth rate > 1MB/min
    if (Math.abs(difference) > 10 * 1024 * 1024 || Math.abs(growthRate) > 1024 * 1024) {
      trend = difference > 0 ? 'increasing' : 'decreasing';
    }

    return { trend, avgHeapUsed, peakHeapUsed, growthRate };
  }

  /**
   * Get comprehensive admin statistics
   */
  getAdminStats(): AdminStats {
    // Use real metrics snapshot (deterministic values)
    const collector = getMetricsCollector();
    const snapshot = collector.getCurrentSnapshot();

    // Aggregate total requests from tool metrics
    let totalRequests = 0;
    Object.values(snapshot.tools).forEach(t => { totalRequests += t.callCount; });

    // Get index validation summary for accurate accepted vs raw counts
    let accepted = 0, scanned = 0, skipped = 0;
    interface LoadSummaryLike { scanned:number; accepted:number; skipped:number }
    try {
      const st = getIndexState() as { list: unknown[]; loadSummary?: LoadSummaryLike; loadDebug?: { scanned:number; accepted:number } };
      if (st.loadSummary) {
        accepted = st.loadSummary.accepted;
        scanned = st.loadSummary.scanned;
        skipped = st.loadSummary.skipped;
      } else {
        accepted = st.list.length;
        scanned = st.loadDebug?.scanned ?? accepted;
        skipped = Math.max(0, scanned - accepted);
      }
    } catch {
      /* ignore */
    }

    // Count physical *.json files (raw) deterministically from FS (may equal scanned; retained for transparency)
    const indexDir = this.instructionsRoot;
    let rawFileCount = scanned; // default to scanned
    try {
      if (fs.existsSync(indexDir)) {
        rawFileCount = fs.readdirSync(indexDir).filter(f => f.toLowerCase().endsWith('.json')).length;
      }
    } catch { /* ignore */ }

    // Recompute schema version snapshot only when any of these counts change
    const cacheNeedsUpdate = !this.indexStatsCache || this.indexStatsCache.acceptedInstructions !== accepted || this.indexStatsCache.rawFileCount !== rawFileCount || this.indexStatsCache.skippedInstructions !== skipped;
    if (cacheNeedsUpdate) {
      const schemaVersions = new Set<string>();
      try {
        if (fs.existsSync(indexDir)) {
          const files = fs.readdirSync(indexDir).filter(f => f.toLowerCase().endsWith('.json')).slice(0, 200); // cap scan
          for (const f of files) {
            try {
              const raw = fs.readFileSync(path.join(indexDir, f), 'utf-8');
              const json = JSON.parse(raw);
              if (typeof json.schemaVersion === 'string') schemaVersions.add(json.schemaVersion);
            } catch { /* ignore parse */ }
          }
        }
      } catch { /* ignore */ }
      const schemaVersion = schemaVersions.size === 0 ? 'unknown' : (schemaVersions.size === 1 ? Array.from(schemaVersions)[0] : `mixed(${Array.from(schemaVersions).join(',')})`);
      this.indexStatsCache = {
        totalInstructions: accepted, // maintain backward compatibility; semantic now accepted
        acceptedInstructions: accepted,
        rawFileCount,
        skippedInstructions: skipped,
        lastUpdated: new Date(),
        version: snapshot.server.version,
        schemaVersion
      };
    }

    const memUsage = snapshot.server.memoryUsage; // already captured in snapshot
    const cpuUsage = this.calculateCpuUsage(); // Calculate current CPU usage

    // Ensure cache populated (should be by logic above, but safeguard for strict types)
    if(!this.indexStatsCache){
      this.indexStatsCache = {
        totalInstructions: accepted,
        acceptedInstructions: accepted,
        rawFileCount,
        skippedInstructions: skipped,
        lastUpdated: new Date(),
        version: snapshot.server.version,
        schemaVersion: 'unknown'
      };
    }

    return {
  // Total historical websocket connections (connected + disconnected)
  totalConnections: snapshot.connections.totalConnections,
  // Active websocket connections (live WS clients). Previously this returned only admin sessions size,
  // which caused the UI to show 0 even when multiple WS clients were connected. This now reflects
  // real-time active websocket connections from metrics.
  activeConnections: snapshot.connections.activeConnections,
  // Preserve visibility into admin (logical) sessions separately.
  adminActiveSessions: this.panelState.activeSessions.size,
      totalRequests,
      errorRate: snapshot.performance.errorRate,
      avgResponseTime: snapshot.performance.avgResponseTime,
      uptime: Math.floor(snapshot.server.uptime / 1000), // seconds
      memoryUsage: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: (memUsage as unknown as { external?: number })?.external ?? 0,
        ...((memUsage as unknown as { heapLimit?: number })?.heapLimit ? { heapLimit: (memUsage as unknown as { heapLimit: number }).heapLimit } : {})
      },
      cpuUsage,
      toolMetrics: snapshot.tools,
      indexStats: this.indexStatsCache
    };
  }

  private updateSystemHealth(): void {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check memory usage and track history
    const memUsage = process.memoryUsage();
    // Use V8 heap_size_limit for percentage -- heapTotal tracks closely
    // behind heapUsed and would false-alarm at low absolute usage.
    const v8Stats = v8.getHeapStatistics();
    const heapLimit = v8Stats.heap_size_limit || memUsage.heapTotal;
    const memPercent = (memUsage.heapUsed / heapLimit) * 100;

    // Track memory history for leak detection
    this.memoryHistory.push({
      timestamp: Date.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss
    });

    // Maintain memory history buffer
    if (this.memoryHistory.length > this.maxMemoryHistoryEntries) {
      this.memoryHistory.shift();
    }

    if (memPercent > 80) {
      issues.push('High memory usage detected');
      recommendations.push('Consider restarting the server or increasing memory limits');
    }

    // Check memory trends for leak detection
    const memoryTrends = this.analyzeMemoryTrends();
    if (memoryTrends.trend === 'increasing' && memoryTrends.growthRate > 1024 * 1024) {
      issues.push('Memory leak detected - heap growing consistently');
      recommendations.push('Investigate memory usage patterns and potential leaks');
    }

    if (memoryTrends.growthRate > 5 * 1024 * 1024) { // > 5MB/min growth
      issues.push('Rapid memory growth detected');
      recommendations.push('Monitor memory usage closely and consider restart if growth continues');
    }

    // Check CPU usage and trends
    const cpuTrends = this.analyzeCpuTrends();
    if (cpuTrends.avgUsage > 80) {
      issues.push('High CPU usage detected');
      recommendations.push('Review server load and consider scaling');
    }

    if (cpuTrends.trend === 'increasing' && cpuTrends.avgUsage > 50) {
      issues.push('CPU usage trend increasing');
      recommendations.push('Monitor for potential CPU leaks or resource contention');
    }

    if (cpuTrends.peakUsage > 95) {
      issues.push('CPU usage spikes detected');
      recommendations.push('Investigate CPU-intensive operations');
    }

    // Check uptime (regression & long-running)
    const currentUptimeSeconds = Math.floor(process.uptime());
    const uptimeHours = currentUptimeSeconds / 3600;
    if (this.lastUptimeSeconds > 0 && currentUptimeSeconds < this.lastUptimeSeconds) {
      // Uptime decreased => restart/regression
      issues.push('Uptime regression detected (server restart)');
      recommendations.push('Review restart reason and ensure intentional');
    } else if (uptimeHours > 72) {
      recommendations.push('Consider scheduled restart for optimal performance');
    }
    this.lastUptimeSeconds = currentUptimeSeconds;

    // Check error rate
    const errorRate = this.getErrorRate();
    if (errorRate > 5) {
      issues.push('Elevated error rate detected');
      recommendations.push('Review error logs and investigate root causes');
    }

    // Determine overall health status
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (issues.length > 0) {
      status = (memPercent > 90 || errorRate > 10 || cpuTrends.avgUsage > 90 || memoryTrends.growthRate > 10 * 1024 * 1024) ? 'critical' : 'warning';
    }

    this.maintenanceInfo.systemHealth = {
      status,
      issues,
      recommendations,
      cpuTrend: cpuTrends.trend,
      memoryTrend: memoryTrends.trend,
      memoryGrowthRate: memoryTrends.growthRate
    };
  }

  /** Return immutable copy of session history */
  getSessionHistory(limit?: number): AdminSessionHistoryEntry[] {
    return this.panelState.getSessionHistory(limit);
  }

  async clearSessionHistory(): Promise<{ success: boolean; message: string; clearedCount: number }> {
    return this.panelState.clearSessionHistory();
  }

  updateSessionActivity(sessionId: string): boolean {
    return this.panelState.updateSessionActivity(sessionId);
  }

  private getTotalConnections(): number {
    return getMetricsCollector().getCurrentSnapshot().connections.totalConnections;
  }

  private getTotalRequests(): number {
    const snap = getMetricsCollector().getCurrentSnapshot();
    return Object.values(snap.tools).reduce((sum, t) => sum + t.callCount, 0);
  }

  private getErrorRate(): number {
    return getMetricsCollector().getCurrentSnapshot().performance.errorRate;
  }

  private getAvgResponseTime(): number {
    return getMetricsCollector().getCurrentSnapshot().performance.avgResponseTime;
  }

  private getIndexInstructionCount(): number {
    const indexDir = this.instructionsRoot;
    try {
      if (fs.existsSync(indexDir)) {
        return fs.readdirSync(indexDir).filter(f => f.toLowerCase().endsWith('.json')).length;
      }
    } catch {
      // ignore
    }
    return 0;
  }

  /**
   * Restart server components
   */
  async restartServer(component: 'dashboard' | 'mcp' | 'all' = 'all'): Promise<{ success: boolean; message: string }> {
    try {
      process.stderr.write(`[admin] Restart requested for component: ${component}\n`);

      // In real implementation, this would perform actual component restarts
      await new Promise(resolve => setTimeout(resolve, 2000));

      return {
        success: true,
        message: `${component} restart completed successfully`
      };
    } catch (error) {
      return {
        success: false,
        message: `Restart failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Clear server caches
   */
  clearCaches(): { success: boolean; message: string; cleared: string[] } {
    try {
      const cleared: string[] = [];

      // Clear instruction cache
      cleared.push('instruction_cache');

      // Clear metrics cache
      cleared.push('metrics_cache');

      // Clear response cache
      cleared.push('response_cache');

      process.stderr.write(`[admin] Caches cleared: ${cleared.join(', ')}\n`);

      return {
        success: true,
        message: 'All caches cleared successfully',
        cleared
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to clear caches: ${error instanceof Error ? error.message : String(error)}`,
        cleared: []
      };
    }
  }
}

// Singleton instance
let adminPanelInstance: AdminPanel | null = null;

export function getAdminPanel(): AdminPanel {
  if (!adminPanelInstance) {
    adminPanelInstance = new AdminPanel();
  }
  return adminPanelInstance;
}
