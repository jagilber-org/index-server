/**
 * API Instructions Routes — Endpoint configuration and management.
 *
 * Manages APIEndpoint CRUD, rate limiting, and request queuing infrastructure
 * used by the APIIntegration coordinator.
 */

// ── Shared type exports consumed by api.usage.routes.ts and api.feedback.routes.ts ─────

export interface APIAuthentication {
  type: 'none' | 'api_key' | 'bearer_token' | 'oauth2' | 'basic_auth' | 'custom';
  config: Record<string, unknown>;
  tokenRefresh?: {
    enabled: boolean;
    endpoint?: string;
    threshold: number;
  };
}

export interface RetryConfig {
  enabled: boolean;
  maxAttempts: number;
  backoffStrategy: 'linear' | 'exponential' | 'fixed';
  baseDelay: number;
  maxDelay: number;
  retryOn: Array<'timeout' | 'network_error' | 'server_error' | 'rate_limit'>;
}

export interface RateLimitConfig {
  enabled: boolean;
  requestsPerMinute: number;
  burstLimit: number;
  queueMaxSize: number;
  dropOnFull: boolean;
}

export interface DataMapping {
  requestTransform?: string;
  responseTransform?: string;
  errorTransform?: string;
  fieldMappings: Array<{
    source: string;
    target: string;
    transform?: string;
  }>;
}

export interface ValidationConfig {
  requestSchema?: object;
  responseSchema?: object;
  validateRequest: boolean;
  validateResponse: boolean;
  strictMode: boolean;
}

export interface MonitoringConfig {
  logRequests: boolean;
  logResponses: boolean;
  logErrors: boolean;
  collectMetrics: boolean;
  alertOnFailure: boolean;
  alertThreshold: number;
}

export interface APIEndpoint {
  id: string;
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  protocol: 'rest' | 'graphql' | 'websocket' | 'grpc';
  authentication: APIAuthentication;
  headers: Record<string, string>;
  timeout: number;
  retryConfig: RetryConfig;
  rateLimit: RateLimitConfig;
  dataMapping: DataMapping;
  validation: ValidationConfig;
  monitoring: MonitoringConfig;
}

// Lightweight request/response placeholders needed by the queue map.
export interface QueuedRequest {
  id: string;
  endpointId: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
}

// ── EndpointManager ──────────────────────────────────────────────────────────────────

export class EndpointManager {
  readonly endpoints: Map<string, APIEndpoint> = new Map();
  readonly requestQueue: Map<string, QueuedRequest[]> = new Map();
  readonly responseCache: Map<string, { response: unknown; expiry: number }> = new Map();
  readonly rateLimiters: Map<string, { requests: number[]; lastReset: number }> = new Map();

  constructor() {
    this.initializeDefaultEndpoints();
  }

  private initializeDefaultEndpoints(): void {
    const defaultEndpoints: APIEndpoint[] = [
      {
        id: 'system_health',
        name: 'System Health Check',
        url: 'http://localhost:8989/api/health',
        method: 'GET',
        protocol: 'rest',
        authentication: { type: 'none', config: {} },
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
        retryConfig: {
          enabled: true,
          maxAttempts: 3,
          backoffStrategy: 'exponential',
          baseDelay: 1000,
          maxDelay: 5000,
          retryOn: ['timeout', 'network_error', 'server_error']
        },
        rateLimit: {
          enabled: true,
          requestsPerMinute: 60,
          burstLimit: 10,
          queueMaxSize: 100,
          dropOnFull: false
        },
        dataMapping: { fieldMappings: [] },
        validation: { validateRequest: false, validateResponse: true, strictMode: false },
        monitoring: {
          logRequests: true,
          logResponses: false,
          logErrors: true,
          collectMetrics: true,
          alertOnFailure: true,
          alertThreshold: 5
        }
      },
      {
        id: 'external_metrics',
        name: 'External Metrics API',
        url: 'https://api.example.com/metrics',
        method: 'POST',
        protocol: 'rest',
        authentication: {
          type: 'api_key',
          config: {
            keyName: 'X-API-Key',
            keyValue: '${API_KEY}'
          }
        },
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Index-Server/1.0'
        },
        timeout: 10000,
        retryConfig: {
          enabled: true,
          maxAttempts: 5,
          backoffStrategy: 'exponential',
          baseDelay: 2000,
          maxDelay: 30000,
          retryOn: ['timeout', 'network_error', 'server_error', 'rate_limit']
        },
        rateLimit: {
          enabled: true,
          requestsPerMinute: 30,
          burstLimit: 5,
          queueMaxSize: 50,
          dropOnFull: true
        },
        dataMapping: {
          requestTransform: `
            function transform(data) {
              return {
                timestamp: Date.now(),
                source: 'index',
                metrics: data
              };
            }
          `,
          responseTransform: `
            function transform(response) {
              return {
                success: response.status === 'ok',
                processed: response.count || 0,
                errors: response.errors || []
              };
            }
          `,
          fieldMappings: [
            { source: 'cpu_usage', target: 'cpu', transform: 'Math.round(value * 100) / 100' },
            { source: 'memory_usage', target: 'memory', transform: 'Math.round(value)' }
          ]
        },
        validation: {
          validateRequest: true,
          validateResponse: true,
          strictMode: true,
          requestSchema: {
            type: 'object',
            properties: {
              metrics: { type: 'array' },
              timestamp: { type: 'number' }
            },
            required: ['metrics', 'timestamp']
          }
        },
        monitoring: {
          logRequests: true,
          logResponses: true,
          logErrors: true,
          collectMetrics: true,
          alertOnFailure: true,
          alertThreshold: 3
        }
      }
    ];

    defaultEndpoints.forEach(endpoint => {
      this.endpoints.set(endpoint.id, endpoint);
      this.initializeRateLimit(endpoint.id, endpoint.rateLimit);
    });
  }

  initializeRateLimit(endpointId: string, config: RateLimitConfig): void {
    if (config.enabled) {
      this.rateLimiters.set(endpointId, { requests: [], lastReset: Date.now() });
    }
  }

  checkRateLimit(endpointId: string): boolean {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint?.rateLimit.enabled) return true;

    const limiter = this.rateLimiters.get(endpointId);
    if (!limiter) return true;

    const now = Date.now();
    const config = endpoint.rateLimit;

    limiter.requests = limiter.requests.filter(time => now - time < 60000);

    if (limiter.requests.length >= config.requestsPerMinute) return false;

    const recentRequests = limiter.requests.filter(time => now - time < 1000);
    if (recentRequests.length >= config.burstLimit) return false;

    limiter.requests.push(now);
    return true;
  }

  createEndpoint(endpoint: Omit<APIEndpoint, 'id'>): string {
    const id = `endpoint_${Date.now()}`;
    const fullEndpoint: APIEndpoint = { id, ...endpoint };
    this.endpoints.set(id, fullEndpoint);
    this.initializeRateLimit(id, fullEndpoint.rateLimit);
    return id;
  }

  getEndpoint(id: string): APIEndpoint | undefined {
    return this.endpoints.get(id);
  }

  listEndpoints(): APIEndpoint[] {
    return Array.from(this.endpoints.values());
  }

  updateEndpoint(id: string, updates: Partial<APIEndpoint>): boolean {
    const endpoint = this.endpoints.get(id);
    if (!endpoint) return false;
    Object.assign(endpoint, updates);
    if (updates.rateLimit) {
      this.initializeRateLimit(id, endpoint.rateLimit);
    }
    return true;
  }

  deleteEndpoint(id: string): boolean {
    this.rateLimiters.delete(id);
    this.requestQueue.delete(id);
    return this.endpoints.delete(id);
  }

  getConfiguredEndpoints(): APIEndpoint[] {
    return Array.from(this.endpoints.values());
  }

  cleanupCache(): void {
    const now = Date.now();
    for (const [key, cached] of Array.from(this.responseCache.entries())) {
      if (cached.expiry <= now) {
        this.responseCache.delete(key);
      }
    }
  }

  resetRateLimiters(): void {
    const now = Date.now();
    this.rateLimiters.forEach(limiter => {
      if (now - limiter.lastReset > 60000) {
        limiter.requests = [];
        limiter.lastReset = now;
      }
    });
  }
}
