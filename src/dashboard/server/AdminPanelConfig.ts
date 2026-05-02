/**
 * AdminPanelConfig — Configuration rendering and serialization logic.
 *
 * Owns the AdminConfig data structure and provides CRUD methods for
 * reading and updating admin panel configuration.
 *
 * Updates here mutate `process.env.INDEX_SERVER_*` and call `reloadRuntimeConfig()`
 * so the dashboard "Server Configuration" panel reflects (and applies to) the
 * single runtimeConfig source of truth.
 */

import { getRuntimeConfig, reloadRuntimeConfig } from '../../config/runtimeConfig';

export interface AdminConfig {
  serverSettings: {
    maxConnections: number;
    requestTimeout: number;
    enableVerboseLogging: boolean;
    enableMutation: boolean;
    rateLimit: {
      perMinute: number;
    };
  };
  indexSettings: {
    autoRefreshInterval: number;
    cacheSize: number;
    enableVersioning: boolean;
  };
  securitySettings: {
    enableCors: boolean;
    allowedOrigins: string[];
    enableAuthentication: boolean;
    sessionTimeout: number;
  };
}

export class AdminPanelConfig {
  private config: AdminConfig;

  constructor() {
    this.config = this.loadDefaultConfig();
  }

  private loadDefaultConfig(): AdminConfig {
    const runtimeConfig = getRuntimeConfig();
    const serverHttp = runtimeConfig.dashboard.http;
    return {
      serverSettings: {
        maxConnections: serverHttp?.maxConnections ?? 100,
        requestTimeout: serverHttp?.requestTimeoutMs ?? 30000,
        enableVerboseLogging: !!serverHttp?.verboseLogging,
        enableMutation: runtimeConfig.mutation.enabled,
        rateLimit: {
          perMinute: serverHttp?.rateLimitPerMinute ?? 0
        }
      },
      indexSettings: {
        autoRefreshInterval: 300000,
        cacheSize: 1000,
        enableVersioning: true
      },
      securitySettings: {
        enableCors: false,
        allowedOrigins: ['http://localhost', 'http://127.0.0.1', 'https://localhost', 'https://127.0.0.1'],
        enableAuthentication: false,
        sessionTimeout: 3600000
      }
    };
  }

  /** Re-read from runtime config so callers always see the current authoritative values. */
  getAdminConfig(): AdminConfig {
    this.config = this.loadDefaultConfig();
    return JSON.parse(JSON.stringify(this.config));
  }

  updateAdminConfig(updates: Partial<AdminConfig>): { success: boolean; message: string; appliedFields?: string[] } {
    try {
      const applied: string[] = [];
      this.applyConfigChanges(updates, applied);
      // Refresh in-memory snapshot from runtime config (post-reload).
      this.config = this.loadDefaultConfig();
      return { success: true, message: 'Configuration updated successfully', appliedFields: applied };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update configuration: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Apply incoming serverSettings to `process.env.INDEX_SERVER_*` and reload runtime config
   * so the dashboard form actually drives behavior. Bind every editable field to its env var
   * (per constitution S-4: "All environment configuration must flow through runtimeConfig.ts").
   */
  private applyConfigChanges(updates: Partial<AdminConfig>, applied: string[] = []): void {
    if (!updates.serverSettings) return;
    const s = updates.serverSettings;
    let needsReload = false;
    if (s.enableVerboseLogging !== undefined) {
      process.env.INDEX_SERVER_VERBOSE_LOGGING = s.enableVerboseLogging ? '1' : '0';
      applied.push('verboseLogging');
      needsReload = true;
    }
    if (s.enableMutation !== undefined) {
      process.env.INDEX_SERVER_MUTATION = s.enableMutation ? '1' : '0';
      applied.push('mutation');
      needsReload = true;
    }
    if (s.maxConnections !== undefined && Number.isFinite(s.maxConnections) && s.maxConnections > 0) {
      process.env.INDEX_SERVER_MAX_CONNECTIONS = String(Math.floor(s.maxConnections));
      applied.push('maxConnections');
      needsReload = true;
    }
    if (s.requestTimeout !== undefined && Number.isFinite(s.requestTimeout) && s.requestTimeout > 0) {
      process.env.INDEX_SERVER_REQUEST_TIMEOUT = String(Math.floor(s.requestTimeout));
      applied.push('requestTimeout');
      needsReload = true;
    }
    if (s.rateLimit && s.rateLimit.perMinute !== undefined && Number.isFinite(s.rateLimit.perMinute) && s.rateLimit.perMinute >= 0) {
      process.env.INDEX_SERVER_RATE_LIMIT = String(Math.floor(s.rateLimit.perMinute));
      applied.push('rateLimitPerMinute');
      needsReload = true;
    }
    if (needsReload) reloadRuntimeConfig();
  }

  /** Session timeout in milliseconds — consumed by state management. */
  get sessionTimeout(): number {
    return this.config.securitySettings.sessionTimeout;
  }
}
