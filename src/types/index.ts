/**
 * Shared types for the mikrotik-mcp server.
 */

/** Result returned per device from any tool fan-out operation. */
export type DeviceResult = {
  deviceId: string;
  success: boolean;
  data?: unknown;
  error?: string;
};

/** Resolved device credentials from KeePass vault. */
export type KeePassCredential = {
  deviceId: string;
  username: string;
  password: string;
  hostname: string;
  /** Optional notes/comment from the KeePass entry. */
  notes: string;
};

/** Parameters for creating a new KeePass entry. */
export type CreateEntryParams = {
  deviceId: string;
  username: string;
  password: string;
  hostname: string;
  notes?: string;
};

/** KeePass client interface. */
export interface KeePassClient {
  listDevices(): Promise<KeePassCredential[]>;
  resolveCredentials(deviceId: string): Promise<KeePassCredential>;
  createEntry(params: CreateEntryParams): Promise<void>;
}

/** SSH transport interface (extends DeviceTransport with legacy executeCommand). */
export interface SshTransport extends DeviceTransport {
  executeCommand(credential: KeePassCredential, command: string): Promise<string>;
}

/** SSH error — base class for all SSH-related errors. */
export class SshError extends Error {
  readonly deviceId: string;
  readonly reason: string;

  constructor(deviceId: string, reason: string) {
    super(`SSH error for device "${deviceId}": ${reason}`);
    this.name = 'SshError';
    this.deviceId = deviceId;
    this.reason = reason;
  }
}

/** Thrown when an SSH command exceeds the configured timeout. */
export class SshTimeoutError extends SshError {
  constructor(deviceId: string, timeoutMs: number) {
    super(deviceId, `Command timed out after ${timeoutMs}ms`);
    this.name = 'SshTimeoutError';
  }
}

/** Thrown when SSH host key verification fails. */
export class SshHostKeyError extends SshError {
  constructor(deviceId: string) {
    super(deviceId, 'Host key verification failed');
    this.name = 'SshHostKeyError';
  }
}

/** A single record returned by RouterOS (all values are strings). */
export type RosRecord = Record<string, string>;

/** Transport-agnostic interface for communicating with RouterOS devices. */
export interface DeviceTransport {
  /** Query a resource path and return all matching records. */
  query(credential: KeePassCredential, path: string): Promise<RosRecord[]>;
  /** Execute a command (add/set/remove) on the device. */
  execute(
    credential: KeePassCredential,
    path: string,
    args?: Record<string, string>,
    options?: { method?: 'PUT' | 'PATCH' | 'DELETE' | 'POST' },
  ): Promise<unknown>;
  /** Execute a raw command and return the stringified JSON response. */
  raw(credential: KeePassCredential, path: string, body?: Record<string, string>): Promise<string>;
}

/** REST API error with device context. */
export class RestError extends Error {
  readonly deviceId: string;
  readonly statusCode: number;
  readonly detail: string;

  constructor(deviceId: string, statusCode: number, detail: string) {
    super(`REST error for device "${deviceId}": ${statusCode} - ${detail}`);
    this.name = 'RestError';
    this.deviceId = deviceId;
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

/** Dependency injection container passed to every tool handler. */
export interface ToolDeps {
  keepass: KeePassClient;
  transport: DeviceTransport;
  sessionId: string;
}
