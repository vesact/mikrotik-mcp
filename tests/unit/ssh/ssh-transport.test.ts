import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { SshTransportImpl, type SshTransportOptions } from '../../../src/ssh/ssh-transport.js';
import { SshError, SshTimeoutError, SshHostKeyError } from '../../../src/types/index.js';
import type { KeePassCredential } from '../../../src/types/index.js';

// --- Mock helpers ---

class MockStream extends EventEmitter {
  stderr = new EventEmitter();
}

function createMockClient() {
  const client = new EventEmitter() as EventEmitter & {
    end: ReturnType<typeof vi.fn>;
    exec: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
  };
  client.end = vi.fn();
  client.exec = vi.fn();
  client.connect = vi.fn();
  return client;
}

// --- Test data ---

const testCredential: KeePassCredential = {
  deviceId: 'Router-01',
  username: 'admin',
  password: 'super-secret-password-123',
  hostname: '192.168.1.1',
};

describe('SshTransportImpl', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Create transport with mock client injected. */
  function createTransport(options?: { timeoutMs?: number; knownHostKeys?: Map<string, string> }) {
    return new SshTransportImpl({
      ...options,
      clientFactory: (() => mockClient) as SshTransportOptions['clientFactory'],
    });
  }

  /** Set up exec mock to return a stream that emits output then closes. */
  function setupSuccessfulExec(output: string) {
    const stream = new MockStream();
    mockClient.exec.mockImplementation(
      (_cmd: string, cb: (err: Error | null, stream: MockStream) => void) => {
        cb(null, stream);
        process.nextTick(() => {
          stream.emit('data', Buffer.from(output));
          stream.emit('close', 0, null);
        });
      },
    );
    return stream;
  }

  describe('successful command execution', () => {
    it('returns raw stdout output from the command', async () => {
      const transport = createTransport();
      const expectedOutput = '/system/identity name="Router-01"\n';

      const promise = transport.executeCommand(testCredential, '/system/identity/print');

      setupSuccessfulExec(expectedOutput);
      mockClient.emit('ready');

      const result = await promise;
      expect(result).toBe(expectedOutput);
    });

    it('passes correct connection options to ssh2 Client', async () => {
      const transport = createTransport({ timeoutMs: 8000 });

      const promise = transport.executeCommand(testCredential, '/test');

      expect(mockClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '192.168.1.1',
          port: 22,
          username: 'admin',
          password: 'super-secret-password-123',
          readyTimeout: 8000,
        }),
      );

      // Clean up: complete the command
      setupSuccessfulExec('');
      mockClient.emit('ready');
      await promise;
    });

    it('closes the SSH session after command execution', async () => {
      const transport = createTransport();

      const promise = transport.executeCommand(testCredential, '/test');

      setupSuccessfulExec('output');
      mockClient.emit('ready');
      await promise;

      expect(mockClient.end).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('throws SshError with deviceId when device is unreachable', async () => {
      const transport = createTransport();

      const promise = transport.executeCommand(testCredential, '/test');
      // Register rejection handler before triggering the error event
      const errorPromise = promise.catch((e: unknown) => e);

      mockClient.emit('error', new Error('connect ECONNREFUSED 192.168.1.1:22'));

      const error = (await errorPromise) as SshError;
      expect(error).toBeInstanceOf(SshError);
      expect(error).not.toBeInstanceOf(SshTimeoutError);
      expect(error).not.toBeInstanceOf(SshHostKeyError);
      expect(error.deviceId).toBe('Router-01');
    });

    it('throws SshTimeoutError when command exceeds timeout', async () => {
      vi.useFakeTimers();

      const transport = createTransport({ timeoutMs: 5000 });

      const promise = transport.executeCommand(testCredential, '/test');
      // Register rejection handler before advancing timers
      const errorPromise = promise.catch((e: unknown) => e);

      // Connection succeeds but command never completes (stream never closes)
      const stream = new MockStream();
      mockClient.exec.mockImplementation(
        (_cmd: string, cb: (err: null, stream: MockStream) => void) => {
          cb(null, stream);
          // Stream never emits 'close' — simulates hung command
        },
      );
      mockClient.emit('ready');

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(5001);

      const error = (await errorPromise) as SshTimeoutError;
      expect(error).toBeInstanceOf(SshTimeoutError);
      expect(error.deviceId).toBe('Router-01');
      expect(mockClient.end).toHaveBeenCalled();
    });

    it('throws SshHostKeyError when host key verification fails', async () => {
      const transport = createTransport(); // no known host keys → rejects all

      const promise = transport.executeCommand(testCredential, '/test');
      // Register rejection handler before triggering events
      const errorPromise = promise.catch((e: unknown) => e);

      // Extract hostVerifier from connect options and invoke it
      const connectOpts = mockClient.connect.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(connectOpts.hostVerifier).toBeTypeOf('function');

      // Call hostVerifier — should reject (no known hosts)
      const hostVerifier = connectOpts.hostVerifier as (key: Buffer) => boolean;
      const accepted = hostVerifier(Buffer.from('unknown-key-hash'));
      expect(accepted).toBe(false);

      // Simulate ssh2 error after host key rejection
      mockClient.emit('error', new Error('Handshake failed: host key not accepted'));

      const error = (await errorPromise) as SshHostKeyError;
      expect(error).toBeInstanceOf(SshHostKeyError);
      expect(error.deviceId).toBe('Router-01');
    });
  });

  describe('credential security', () => {
    it('error messages never contain password or credential values', async () => {
      const transport = createTransport();
      const sensitiveValues = [testCredential.password, testCredential.username];

      // Emit an error that pathologically contains credentials in its message
      const promise = transport.executeCommand(testCredential, '/test');
      // Register rejection handler before triggering the error event
      const errorPromise = promise.catch((e: unknown) => e);

      mockClient.emit(
        'error',
        new Error(
          `Authentication failed for user admin with password super-secret-password-123 on 192.168.1.1`,
        ),
      );

      const error = (await errorPromise) as Error;
      const message = error.message;

      for (const sensitive of sensitiveValues) {
        expect(message).not.toContain(sensitive);
      }

      // Should still contain deviceId for traceability
      expect(message).toContain('Router-01');
    });
  });

  describe('query()', () => {
    it('calls executeCommand with /print detail and parses detail records', async () => {
      const transport = createTransport();
      const detailOutput = ` 0   address=10.0.0.1/24 interface=ether1 disabled=false\n\n 1   address=192.168.1.1/24 interface=bridge1 disabled=false\n`;

      const promise = transport.query(testCredential, '/ip/address');

      setupSuccessfulExec(detailOutput);
      mockClient.emit('ready');

      const result = await promise;
      expect(mockClient.exec).toHaveBeenCalledWith(
        '/ip/address/print detail',
        expect.any(Function),
      );
      expect(result.length).toBe(2);
      expect(result[0]['address']).toBe('10.0.0.1/24');
      expect(result[0]['interface']).toBe('ether1');
    });

    it('falls back to parseKeyValue for single-record output', async () => {
      const transport = createTransport();
      const kvOutput = `                   name: Router-01\n`;

      const promise = transport.query(testCredential, '/system/identity');

      setupSuccessfulExec(kvOutput);
      mockClient.emit('ready');

      const result = await promise;
      expect(result).toEqual([{ name: 'Router-01' }]);
    });

    it('returns empty array for empty output', async () => {
      const transport = createTransport();

      const promise = transport.query(testCredential, '/ip/address');

      setupSuccessfulExec('');
      mockClient.emit('ready');

      const result = await promise;
      expect(result).toEqual([]);
    });
  });

  describe('execute()', () => {
    it('builds add command with args', async () => {
      const transport = createTransport();

      const promise = transport.execute(testCredential, '/ip/address/add', {
        address: '10.0.0.5/24',
        interface: 'ether2',
      });

      setupSuccessfulExec('');
      mockClient.emit('ready');

      await promise;
      expect(mockClient.exec).toHaveBeenCalledWith(
        '/ip/address/add address=10.0.0.5/24 interface=ether2',
        expect.any(Function),
      );
    });

    it('builds set command with .id', async () => {
      const transport = createTransport();

      const promise = transport.execute(testCredential, '/ip/address/set', {
        '.id': '*1',
        comment: 'test',
      });

      setupSuccessfulExec('');
      mockClient.emit('ready');

      await promise;
      expect(mockClient.exec).toHaveBeenCalledWith(
        '/ip/address/set .id=*1 comment=test',
        expect.any(Function),
      );
    });

    it('quotes values with spaces', async () => {
      const transport = createTransport();

      const promise = transport.execute(testCredential, '/ip/address/set', {
        '.id': '*1',
        comment: 'my comment',
      });

      setupSuccessfulExec('');
      mockClient.emit('ready');

      await promise;
      expect(mockClient.exec).toHaveBeenCalledWith(
        '/ip/address/set .id=*1 comment="my comment"',
        expect.any(Function),
      );
    });

    it('builds remove command', async () => {
      const transport = createTransport();

      const promise = transport.execute(testCredential, '/ip/address/remove', {
        '.id': '*1',
      });

      setupSuccessfulExec('');
      mockClient.emit('ready');

      await promise;
      expect(mockClient.exec).toHaveBeenCalledWith(
        '/ip/address/remove .id=*1',
        expect.any(Function),
      );
    });
  });

  describe('raw()', () => {
    it('passes command directly and returns raw output', async () => {
      const transport = createTransport();
      const rawOutput = 'some raw output\n';

      const promise = transport.raw(testCredential, '/ping address=8.8.8.8 count=4');

      setupSuccessfulExec(rawOutput);
      mockClient.emit('ready');

      const result = await promise;
      expect(result).toBe(rawOutput);
    });

    it('appends body args to command', async () => {
      const transport = createTransport();

      const promise = transport.raw(testCredential, '/ping', {
        address: '8.8.8.8',
        count: '4',
      });

      setupSuccessfulExec('result');
      mockClient.emit('ready');

      await promise;
      expect(mockClient.exec).toHaveBeenCalledWith(
        '/ping address=8.8.8.8 count=4',
        expect.any(Function),
      );
    });
  });
});
