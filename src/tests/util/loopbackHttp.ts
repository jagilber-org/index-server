import http, { type IncomingHttpHeaders } from 'http';

export interface LoopbackHttpRequestOptions {
  url: string;
  method?: string;
  body?: string | Buffer;
  headers?: Record<string, string | number>;
  timeoutMs?: number;
  attempts?: number;
}

export interface LoopbackHttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

const TRANSIENT_SOCKET_ERRORS = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT']);

function requestOnce(options: LoopbackHttpRequestOptions): Promise<LoopbackHttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(options.url);
    let settled = false;
    const finish = <T>(callback: (value: T) => void, value: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };

    const request = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method ?? 'GET',
        headers: options.headers,
        agent: false,
      },
      response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => finish(resolve, {
          status: response.statusCode ?? 0,
          headers: response.headers,
          body,
        }));
        response.on('error', error => finish(reject, error));
      },
    );

    const timer = setTimeout(() => {
      const error = Object.assign(
        new Error(`Loopback HTTP request timed out: ${options.method ?? 'GET'} ${options.url}`),
        { code: 'ETIMEDOUT' },
      );
      request.destroy(error);
    }, options.timeoutMs ?? 5_000);
    timer.unref();

    request.on('error', error => finish(reject, error));
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

/**
 * Make a bounded loopback HTTP request with fresh sockets and retries for
 * transient Windows connect/reset failures seen during highly parallel tests.
 */
export async function requestLoopback(options: LoopbackHttpRequestOptions): Promise<LoopbackHttpResponse> {
  const attempts = options.attempts ?? 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await requestOnce(options);
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (!TRANSIENT_SOCKET_ERRORS.has(code ?? '') || attempt === attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }

  throw lastError;
}
