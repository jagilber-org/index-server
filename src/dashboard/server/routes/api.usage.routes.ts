/**
 * API Usage Routes — Request execution and monitoring.
 *
 * Manages API request execution (retry, rate-limit enforcement, auth, transforms)
 * and the monitoring event bus. Depends on EndpointManager for endpoint config.
 */

import type { EndpointManager, APIAuthentication, RetryConfig, DataMapping } from './api.instructions.routes.js';
import { logError, logWarn } from '../../../services/logger.js';

// ── Type exports ─────────────────────────────────────────────────────────────────────

export interface APIRequest {
  id: string;
  endpointId: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  timestamp: number;
  timeout: number;
}

export interface APIResponse {
  requestId: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  responseTime: number;
  timestamp: number;
  error?: string;
}

export interface APIMonitoringEvent {
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

// ── UsageManager ─────────────────────────────────────────────────────────────────────

export class UsageManager {
  private readonly monitoringCallbacks: Array<(event: APIMonitoringEvent) => void> = [];

  constructor(private readonly endpointMgr: EndpointManager) {}

  async executeRequest(
    endpointId: string,
    data?: unknown,
    overrides?: Partial<APIRequest>
  ): Promise<APIResponse> {
    const endpoint = this.endpointMgr.getEndpoint(endpointId);
    if (!endpoint) throw new Error(`Endpoint not found: ${endpointId}`);

    if (!this.endpointMgr.checkRateLimit(endpointId)) {
      throw new Error(`Rate limit exceeded for endpoint: ${endpointId}`);
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const request: APIRequest = {
      id: requestId,
      endpointId,
      method: endpoint.method,
      url: endpoint.url,
      headers: { ...endpoint.headers, ...(overrides?.headers || {}) },
      body: data,
      timestamp: Date.now(),
      timeout: overrides?.timeout || endpoint.timeout
    };

    this.applyAuthentication(request, endpoint.authentication);

    if (data && endpoint.dataMapping.requestTransform) {
      try {
        request.body = this.applySafeTransform(data, endpoint.dataMapping.requestTransform);
      } catch (error) {
        logError('Request transform error:', error);
      }
    }

    if (endpoint.validation.validateRequest && endpoint.validation.requestSchema) {
      const valid = this.validateData(request.body, endpoint.validation.requestSchema);
      if (!valid && endpoint.validation.strictMode) {
        throw new Error('Request validation failed');
      }
    }

    if (endpoint.monitoring.logRequests) {
      this.logAPIEvent('request', { endpointId, requestId, url: request.url, method: request.method });
    }

    const response = await this.executeWithRetry(request, endpoint.retryConfig);

    if (endpoint.dataMapping.responseTransform) {
      try {
        response.body = this.applySafeTransform(response.body, endpoint.dataMapping.responseTransform);
      } catch (error) {
        logError('Response transform error:', error);
      }
    }

    if (endpoint.dataMapping.fieldMappings.length > 0) {
      response.body = this.applyFieldMappings(response.body, endpoint.dataMapping.fieldMappings);
    }

    if (endpoint.validation.validateResponse && endpoint.validation.responseSchema) {
      const valid = this.validateData(response.body, endpoint.validation.responseSchema);
      if (!valid && endpoint.validation.strictMode) {
        logWarn('Response validation failed for endpoint:', endpointId);
      }
    }

    if (endpoint.monitoring.logResponses) {
      this.logAPIEvent('response', {
        endpointId,
        requestId,
        status: response.status,
        responseTime: response.responseTime
      });
    }

    if (response.error && endpoint.monitoring.logErrors) {
      this.logAPIEvent('error', { endpointId, requestId, error: response.error, status: response.status });
    }

    if (endpoint.monitoring.collectMetrics) {
      this.collectMetrics(endpointId, response);
    }

    return response;
  }

  async executeWithRetry(request: APIRequest, retryConfig: RetryConfig): Promise<APIResponse> {
    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt <= retryConfig.maxAttempts) {
      try {
        const response = await this.performHTTPRequest(request);
        if (this.shouldRetry(response, retryConfig)) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        attempt++;
        if (attempt > retryConfig.maxAttempts) break;
        if (!this.shouldRetryError(lastError, retryConfig)) break;
        const delay = this.calculateRetryDelay(attempt, retryConfig);
        await this.sleep(delay);
      }
    }

    return {
      requestId: request.id,
      status: 0,
      statusText: 'Request Failed',
      headers: {},
      body: null,
      responseTime: 0,
      timestamp: Date.now(),
      error: lastError?.message || 'Unknown error'
    };
  }

  async performHTTPRequest(request: APIRequest): Promise<APIResponse> {
    const startTime = Date.now();
    try {
      const response = await this.simulateHTTPRequest(request);
      return {
        requestId: request.id,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: response.body,
        responseTime: Date.now() - startTime,
        timestamp: Date.now()
      };
    } catch (error) {
      throw new Error(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async simulateHTTPRequest(request: APIRequest): Promise<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: unknown;
  }> {
    await this.sleep(Math.random() * 100 + 50);

    const scenarios = [
      { weight: 0.8, status: 200, statusText: 'OK', body: { success: true, data: 'Response data' } },
      { weight: 0.1, status: 429, statusText: 'Too Many Requests', body: { error: 'Rate limit exceeded' } },
      { weight: 0.05, status: 500, statusText: 'Internal Server Error', body: { error: 'Server error' } },
      { weight: 0.05, status: 503, statusText: 'Service Unavailable', body: { error: 'Service unavailable' } }
    ];

    const random = Math.random();
    let cumulative = 0;
    for (const scenario of scenarios) {
      cumulative += scenario.weight;
      if (random <= cumulative) {
        return { status: scenario.status, statusText: scenario.statusText, headers: { 'Content-Type': 'application/json' }, body: scenario.body };
      }
    }

    return { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' }, body: { success: true, data: request.body } };
  }

  private shouldRetry(response: APIResponse, retryConfig: RetryConfig): boolean {
    if (!retryConfig.enabled) return false;
    if (response.status >= 500 || response.status === 429) {
      return retryConfig.retryOn.includes('server_error') || retryConfig.retryOn.includes('rate_limit');
    }
    return false;
  }

  private shouldRetryError(error: Error, retryConfig: RetryConfig): boolean {
    if (!retryConfig.enabled) return false;
    const message = error.message.toLowerCase();
    if (message.includes('timeout') && retryConfig.retryOn.includes('timeout')) return true;
    if ((message.includes('network') || message.includes('fetch')) && retryConfig.retryOn.includes('network_error')) return true;
    return false;
  }

  private calculateRetryDelay(attempt: number, retryConfig: RetryConfig): number {
    let delay: number;
    switch (retryConfig.backoffStrategy) {
      case 'linear':
        delay = retryConfig.baseDelay * attempt;
        break;
      case 'exponential':
        delay = retryConfig.baseDelay * Math.pow(2, attempt - 1);
        break;
      case 'fixed':
      default:
        delay = retryConfig.baseDelay;
        break;
    }
    return Math.min(delay, retryConfig.maxDelay);
  }

  applyAuthentication(request: APIRequest, auth: APIAuthentication): void {
    switch (auth.type) {
      case 'api_key': {
        const keyName = auth.config.keyName as string;
        const keyValue = this.resolveConfigValue(auth.config.keyValue as string);
        request.headers[keyName] = keyValue;
        break;
      }
      case 'bearer_token': {
        const token = this.resolveConfigValue(auth.config.token as string);
        request.headers['Authorization'] = `Bearer ${token}`;
        break;
      }
      case 'basic_auth': {
        const username = this.resolveConfigValue(auth.config.username as string);
        const password = this.resolveConfigValue(auth.config.password as string);
        const credentials = Buffer.from(`${username}:${password}`).toString('base64');
        request.headers['Authorization'] = `Basic ${credentials}`;
        break;
      }
      case 'oauth2':
        logWarn('OAuth2 authentication not fully implemented');
        break;
      case 'custom': {
        const customHeaders = auth.config.headers as Record<string, string>;
        Object.assign(request.headers, customHeaders);
        break;
      }
      case 'none':
      default:
        break;
    }
  }

  resolveConfigValue(value: string): string {
    if (value.startsWith('${') && value.endsWith('}')) {
      const envVar = value.slice(2, -1);
      return process.env[envVar] || value;
    }
    return value;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applySafeTransform(data: any, transformSpec: string): any {
    if (!data || !transformSpec) return data;
    const dotPath = transformSpec.trim().match(/^(?:data|response|value)\.(.+)$/);
    if (dotPath) {
      const parts = dotPath[1].split('.');
      let result = data;
      for (const part of parts) {
        if (result == null || typeof result !== 'object') return data;
        result = result[part];
      }
      return result;
    }
    return data;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applySafeFieldTransform(value: any, transform: string): any {
    const t = transform.trim();
    if (t === 'String(value)' || t === 'value.toString()') return String(value);
    if (t === 'Number(value)' || t === 'parseInt(value)') return Number(value);
    if (t === 'Boolean(value)') return Boolean(value);
    if (t === 'JSON.parse(value)') { try { return JSON.parse(value); } catch { return value; } }
    if (t === 'JSON.stringify(value)') return JSON.stringify(value);
    if (t === 'value.toLowerCase()') return typeof value === 'string' ? value.toLowerCase() : value;
    if (t === 'value.toUpperCase()') return typeof value === 'string' ? value.toUpperCase() : value;
    if (t === 'value.trim()') return typeof value === 'string' ? value.trim() : value;
    const dotPath = t.match(/^value\.(.+)$/);
    if (dotPath) {
      let result = value;
      for (const part of dotPath[1].split('.')) {
        if (result == null || typeof result !== 'object') return value;
        result = result[part];
      }
      return result;
    }
    return value;
  }

  applyFieldMappings(data: unknown, mappings: DataMapping['fieldMappings']): unknown {
    if (!data || typeof data !== 'object' || !Array.isArray(mappings)) return data;
    const result = { ...data } as Record<string, unknown>;
    mappings.forEach(mapping => {
      const sourceValue = this.getNestedValue(result, mapping.source);
      let targetValue = sourceValue;
      if (mapping.transform) {
        try {
          targetValue = this.applySafeFieldTransform(sourceValue, mapping.transform);
        } catch (error) {
          logError('Field mapping transform error:', error);
        }
      }
      this.setNestedValue(result, mapping.target, targetValue);
    });
    return result;
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce((current: unknown, key: string) => {
      return current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined;
    }, obj as unknown);
  }

  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    const target = keys.reduce((current, key) => {
      if (!current[key] || typeof current[key] !== 'object') current[key] = {};
      return current[key] as Record<string, unknown>;
    }, obj);
    target[lastKey] = value;
  }

  private validateData(data: unknown, _schema: object): boolean {
    try {
      if (typeof data !== 'object' || data === null) return false;
      return true;
    } catch {
      return false;
    }
  }

  private collectMetrics(endpointId: string, response: APIResponse): void {
    this.logAPIEvent('metrics', {
      endpointId,
      responseTime: response.responseTime,
      status: response.status,
      success: response.status >= 200 && response.status < 300
    });
  }

  logAPIEvent(type: string, data: Record<string, unknown>): void {
    const event: APIMonitoringEvent = { type, timestamp: Date.now(), data };
    this.monitoringCallbacks.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        logError('API monitoring callback error:', error);
      }
    });
  }

  onAPIEvent(callback: (event: APIMonitoringEvent) => void): void {
    this.monitoringCallbacks.push(callback);
  }

  processRequestQueues(): void {
    this.endpointMgr.requestQueue.forEach((requests, endpointId) => {
      if (requests.length === 0) return;
      const endpoint = this.endpointMgr.getEndpoint(endpointId);
      if (!endpoint?.rateLimit.enabled) return;
      if (this.endpointMgr.checkRateLimit(endpointId)) {
        const request = requests.shift();
        if (request) {
          this.executeRequest(endpointId, request.body, {
            headers: request.headers,
            timeout: request.timeout
          }).catch(error => {
            logError('Queued request execution error:', error);
          });
        }
      }
    });
  }

  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
