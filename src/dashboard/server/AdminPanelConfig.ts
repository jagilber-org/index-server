/**
 * AdminPanelConfig — Configuration rendering and serialization logic.
 *
 * Owns the AdminConfig data structure and provides CRUD methods for
 * reading and updating admin panel configuration.
 */

import { getRuntimeConfig, reloadRuntimeConfig } from '../../config/runtimeConfig';

export interface AdminConfig {
  serverSettings: {
    maxConnections: number;
    requestTimeout: number;
    enableVerboseLogging: boolean;
    enableMutation: boolean;
    rateLimit: {
      windowMs: number;
      maxRequests: number;
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
          windowMs: 60000,
          maxRequests: 100
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

  getAdminConfig(): AdminConfig {
    return JSON.parse(JSON.stringify(this.config));
  }

  updateAdminConfig(updates: Partial<AdminConfig>): { success: boolean; message: string } {
    try {
      this.config = { ...this.config, ...updates };
      this.applyConfigChanges(updates);
      return { success: true, message: 'Configuration updated successfully' };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update configuration: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private applyConfigChanges(updates: Partial<AdminConfig>): void {
    if (updates.serverSettings) {
      let runtimeReloadNeeded = false;
      if (updates.serverSettings.enableVerboseLogging !== undefined) {
        process.env.INDEX_SERVER_VERBOSE_LOGGING = updates.serverSettings.enableVerboseLogging ? '1' : '0';
        runtimeReloadNeeded = true;
      }
      if (updates.serverSettings.enableMutation !== undefined) {
        process.env.INDEX_SERVER_MUTATION = updates.serverSettings.enableMutation ? '1' : '0';
        runtimeReloadNeeded = true;
      }
      if (runtimeReloadNeeded) {
        reloadRuntimeConfig();
      }
    }
  }

  /** Session timeout in milliseconds — consumed by state management. */
  get sessionTimeout(): number {
    return this.config.securitySettings.sessionTimeout;
  }
}
