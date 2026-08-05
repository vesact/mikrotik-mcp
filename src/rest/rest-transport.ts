/**
 * REST transport layer — sole owner of HTTP connections to RouterOS devices.
 * No other module may use fetch against device IPs (architectural boundary).
 */
import type { DeviceTransport, KeePassCredential, RosRecord } from '../types/index.js';
import { RestError } from '../types/index.js';

export interface RestTransportOptions {
  /** REST API port (default: ROUTEROS_REST_PORT env or 443). */
  port?: number;
  /** URL scheme (default: ROUTEROS_REST_SCHEME env or 'https'). */
  scheme?: string;
  /** Request timeout in milliseconds (default: ROUTEROS_TIMEOUT_MS or SSH_TIMEOUT_MS env or 10000). */
  timeoutMs?: number;
  /** Custom fetch implementation (injectable for testing). */
  fetchFn?: typeof fetch;
}

export class RestTransportImpl implements DeviceTransport {
  private readonly port: number;
  private readonly scheme: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options?: RestTransportOptions) {
    this.port = options?.port ?? parseInt(process.env.ROUTEROS_REST_PORT ?? '443', 10);
    this.scheme = options?.scheme ?? process.env.ROUTEROS_REST_SCHEME ?? 'https';
    this.timeoutMs =
      options?.timeoutMs ??
      parseInt(process.env.ROUTEROS_TIMEOUT_MS ?? process.env.SSH_TIMEOUT_MS ?? '10000', 10);
    this.fetchFn = options?.fetchFn ?? fetch;
  }

  async query(credential: KeePassCredential, path: string): Promise<RosRecord[]> {
    const url = this.buildUrl(credential.hostname, path);
    const response = await this.request(credential, url, 'GET');
    const body = await response.json();
    // RouterOS returns a single object for singleton resources (e.g. /system/identity)
    if (Array.isArray(body)) return body as RosRecord[];
    return [body as RosRecord];
  }

  async execute(
    credential: KeePassCredential,
    path: string,
    args?: Record<string, string>,
    options?: { method?: 'PUT' | 'PATCH' | 'DELETE' | 'POST' },
  ): Promise<unknown> {
    const method = options?.method ?? this.inferMethod(path, args);
    const url = this.buildUrl(credential.hostname, path);
    const response = await this.request(credential, url, method, args);
    const text = await response.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async raw(
    credential: KeePassCredential,
    path: string,
    body?: Record<string, string>,
  ): Promise<string> {
    const url = this.buildUrl(credential.hostname, path);
    const response = await this.request(credential, url, 'POST', body);
    const json = await response.json();
    return JSON.stringify(json);
  }

  private inferMethod(
    path: string,
    args?: Record<string, string>,
  ): 'PUT' | 'PATCH' | 'DELETE' | 'POST' {
    const hasId = /\*[0-9A-Fa-f]+/.test(path);
    if (hasId && (!args || Object.keys(args).length === 0)) return 'DELETE';
    if (hasId) return 'PATCH';
    if (args && Object.keys(args).length > 0) return 'PUT';
    return 'POST';
  }

  private buildUrl(hostname: string, path: string): string {
    // Ensure path starts with /
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.scheme}://${hostname}:${this.port}/rest${normalizedPath}`;
  }

  private async request(
    credential: KeePassCredential,
    url: string,
    method: string,
    body?: Record<string, string>,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Basic ${btoa(`${credential.username}:${credential.password}`)}`,
      'Content-Type': 'application/json',
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers,
        body: body && Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeout);
      throw this.handleNetworkError(credential, err);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      await this.handleHttpError(credential, response);
    }

    return response;
  }

  private handleNetworkError(credential: KeePassCredential, err: unknown): RestError {
    const message = err instanceof Error ? err.message : String(err);
    const sanitized = this.sanitize(message, credential);

    if (message.includes('abort') || message.includes('AbortError')) {
      return new RestError(credential.deviceId, 0, `Request timed out after ${this.timeoutMs}ms`);
    }

    return new RestError(credential.deviceId, 0, sanitized);
  }

  private async handleHttpError(credential: KeePassCredential, response: Response): Promise<never> {
    let detail: string;
    try {
      const body = await response.json();
      detail =
        (body as { detail?: string; message?: string }).detail ??
        (body as { message?: string }).message ??
        response.statusText;
    } catch {
      detail = response.statusText;
    }

    throw new RestError(credential.deviceId, response.status, this.sanitize(detail, credential));
  }

  /** Strip credential values from error messages (NFR-SEC-1). */
  private sanitize(message: string, credential: KeePassCredential): string {
    let sanitized = message;
    if (credential.password) {
      sanitized = sanitized.replaceAll(credential.password, '[REDACTED]');
    }
    if (credential.username) {
      sanitized = sanitized.replaceAll(credential.username, '[REDACTED]');
    }
    return sanitized;
  }
}
