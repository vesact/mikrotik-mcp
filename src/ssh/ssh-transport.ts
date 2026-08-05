/**
 * SSH transport layer — sole owner of SSH connections.
 * No other module may import ssh2 directly (architectural boundary).
 */
import { Client } from 'ssh2';
import { parseDetailRecords, parseKeyValue } from '../parsers.js';
import type { KeePassCredential, RosRecord, SshTransport } from '../types/index.js';
import { SshError, SshHostKeyError, SshTimeoutError } from '../types/index.js';

export interface SshTransportOptions {
  /** Command/connection timeout in milliseconds (default: SSH_TIMEOUT_MS env or 10000). */
  timeoutMs?: number;
  /** Factory for creating ssh2 Client instances (injectable for testing). */
  clientFactory?: () => Client;
  /** Map of hostname → hex-encoded host key for verification. */
  knownHostKeys?: Map<string, string>;
  /** Accept all host keys without verification (development/testing only). */
  acceptAllHostKeys?: boolean;
}

export class SshTransportImpl implements SshTransport {
  private readonly timeoutMs: number;
  private readonly clientFactory: () => Client;
  private readonly knownHostKeys: Map<string, string>;
  private readonly acceptAllHostKeys: boolean;

  constructor(options?: SshTransportOptions) {
    this.timeoutMs = options?.timeoutMs ?? parseInt(process.env.SSH_TIMEOUT_MS ?? '10000', 10);
    this.clientFactory = options?.clientFactory ?? (() => new Client());
    this.knownHostKeys = options?.knownHostKeys ?? new Map();
    this.acceptAllHostKeys = options?.acceptAllHostKeys ?? false;
  }

  async executeCommand(credential: KeePassCredential, command: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const conn = this.clientFactory();
      let settled = false;
      let hostKeyRejected = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          conn.end();
          reject(new SshTimeoutError(credential.deviceId, this.timeoutMs));
        }
      }, this.timeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
      };

      conn.on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            if (!settled) {
              settled = true;
              cleanup();
              conn.end();
              reject(new SshError(credential.deviceId, this.sanitize(err.message, credential)));
            }
            return;
          }

          let stdout = '';

          stream.on('data', (data: Buffer) => {
            stdout += data.toString();
          });

          stream.stderr.on('data', () => {
            // stderr ignored — RouterOS uses stdout for output
          });

          stream.on('close', () => {
            if (!settled) {
              settled = true;
              cleanup();
              conn.end();
              resolve(stdout);
            }
          });
        });
      });

      conn.on('error', (err: Error) => {
        if (!settled) {
          settled = true;
          cleanup();
          if (hostKeyRejected) {
            reject(new SshHostKeyError(credential.deviceId));
          } else {
            reject(new SshError(credential.deviceId, this.sanitize(err.message, credential)));
          }
        }
      });

      conn.connect({
        host: credential.hostname,
        port: 22,
        forceIPv4: true,
        username: credential.username,
        password: credential.password,
        readyTimeout: this.timeoutMs,
        hostVerifier: (key: Buffer): boolean => {
          if (this.acceptAllHostKeys) {
            return true;
          }
          const knownKey = this.knownHostKeys.get(credential.hostname);
          if (knownKey !== undefined && knownKey === key.toString('hex')) {
            return true;
          }
          hostKeyRejected = true;
          return false;
        },
      });
    });
  }

  /** Strip credential values from error messages to satisfy NFR-SEC-1. */
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

  async query(credential: KeePassCredential, path: string): Promise<RosRecord[]> {
    const command = `${path}/print detail`;
    const raw = await this.executeCommand(credential, command);
    const records = parseDetailRecords(raw);
    if (records.length > 0) return records;
    // Fallback: try key-value format (single-record paths like /system/identity)
    const trimmed = raw.trim();
    if (trimmed) {
      const kv = parseKeyValue(raw);
      if (Object.keys(kv).length > 0) return [kv];
    }
    return [];
  }

  async execute(
    credential: KeePassCredential,
    path: string,
    args?: Record<string, string>,
  ): Promise<unknown> {
    let command = path;
    if (args && Object.keys(args).length > 0) {
      const parts = Object.entries(args).map(([k, v]) => {
        if (v.includes(' ')) return `${k}="${v}"`;
        return `${k}=${v}`;
      });
      command += ` ${parts.join(' ')}`;
    }
    const result = await this.executeCommand(credential, command);
    return result || undefined;
  }

  async raw(
    credential: KeePassCredential,
    command: string,
    body?: Record<string, string>,
  ): Promise<string> {
    let fullCommand = command;
    if (body && Object.keys(body).length > 0) {
      const parts = Object.entries(body).map(([k, v]) => {
        if (v.includes(' ')) return `${k}="${v}"`;
        return `${k}=${v}`;
      });
      fullCommand += ` ${parts.join(' ')}`;
    }
    return this.executeCommand(credential, fullCommand);
  }
}
