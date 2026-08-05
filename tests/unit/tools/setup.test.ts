import { beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise the optional port-relocation path of setup-new-device.
process.env.ROUTEROS_SETUP_PORT = '8080';

// --- Hoisted mock fns (available inside vi.mock factories) ---

const {
  mockPort80Query,
  mockPort80Execute,
  mockTargetQuery,
  mockTargetExecute,
  mockCreateEntry,
  mockListDevices,
  mockResolveCredentials,
} = vi.hoisted(() => ({
  mockPort80Query: vi.fn(),
  mockPort80Execute: vi.fn(),
  mockTargetQuery: vi.fn(),
  mockTargetExecute: vi.fn(),
  mockCreateEntry: vi.fn(),
  mockListDevices: vi.fn(),
  mockResolveCredentials: vi.fn(),
}));

// --- Module mocks ---

vi.mock('../../../src/rest/rest-transport.js', () => ({
  RestTransportImpl: class MockRestTransport {
    private _port: number;
    query: typeof mockPort80Query;
    execute: typeof mockPort80Execute;
    raw = vi.fn();

    constructor(opts?: { port?: number; scheme?: string }) {
      this._port = opts?.port ?? 443;
      if (this._port === 80) {
        this.query = mockPort80Query;
        this.execute = mockPort80Execute;
      } else {
        this.query = mockTargetQuery;
        this.execute = mockTargetExecute;
      }
    }
  },
}));

// --- Imports (after mocks) ---

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { generatePassword, registerSetupTools } from '../../../src/tools/setup.js';
import type { DeviceTransport, KeePassClient } from '../../../src/types/index.js';

// --- Helpers ---

function getHandler(
  server: McpServer,
): (...args: unknown[]) => Promise<{ content: Array<{ text: string }> }> {
  const tools = (
    server as unknown as {
      _registeredTools: Record<
        string,
        { handler: (...args: unknown[]) => Promise<{ content: Array<{ text: string }> }> }
      >;
    }
  )._registeredTools;
  return tools['setup-new-device'].handler;
}

function setupHappyPath(): void {
  // Step 1: connectivity check (port 80 query /system/identity)
  mockPort80Query.mockResolvedValueOnce([{ name: 'MikroTik' }]);

  // Step 3: set identity (port 80 execute)
  mockPort80Execute.mockResolvedValueOnce(undefined);

  // Step 4a: query services (port 80 query /ip/service)
  mockPort80Query.mockResolvedValueOnce([
    { '.id': '*1', name: 'telnet', port: '23' },
    { '.id': '*2', name: 'www', port: '80' },
    { '.id': '*3', name: 'ssh', port: '22' },
  ]);
  // Step 4b: set service port (port 80 execute)
  mockPort80Execute.mockResolvedValueOnce(undefined);

  // Step 5a: query users (target-port query /user)
  mockTargetQuery.mockResolvedValueOnce([{ '.id': '*1', name: 'admin', group: 'full' }]);
  // Step 5b: set password (target-port execute)
  mockTargetExecute.mockResolvedValueOnce(undefined);

  // Step 6: KeePass createEntry
  mockCreateEntry.mockResolvedValueOnce(undefined);

  // Step 7: verify (target-port query /system/identity with new creds)
  mockTargetQuery.mockResolvedValueOnce([{ name: 'chr-95' }]);
}

// --- Tests ---

describe('generatePassword', () => {
  it('generates a 40-character password by default', () => {
    const pw = generatePassword();
    expect(pw).toHaveLength(40);
  });

  it('uses only alphanumeric characters (no special chars)', () => {
    const pw = generatePassword();
    expect(pw).toMatch(/^[a-zA-Z0-9]+$/);
  });

  it('respects custom length', () => {
    expect(generatePassword(10)).toHaveLength(10);
    expect(generatePassword(64)).toHaveLength(64);
  });

  it('generates different passwords on successive calls', () => {
    const a = generatePassword();
    const b = generatePassword();
    expect(a).not.toBe(b);
  });
});

describe('registerSetupTools', () => {
  let server: McpServer;
  let mockKeepass: KeePassClient;
  let mockTransport: DeviceTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpServer({ name: 'test', version: '1.0.0' });
    mockKeepass = {
      listDevices: mockListDevices,
      resolveCredentials: mockResolveCredentials,
      createEntry: mockCreateEntry,
    };
    mockTransport = { query: vi.fn(), execute: vi.fn(), raw: vi.fn() };
  });

  it('registers the setup-new-device tool', () => {
    registerSetupTools(server, mockKeepass, mockTransport);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(tools).toHaveProperty('setup-new-device');
  });

  describe('happy path', () => {
    it('returns success with identity and ip', async () => {
      registerSetupTools(server, mockKeepass, mockTransport);
      const handler = getHandler(server);
      setupHappyPath();

      const result = await handler({ ip: '192.0.2.95', identity: 'chr-95' }, {});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual({
        success: true,
        identity: 'chr-95',
        ip: '192.0.2.95',
      });
    });

    it('password is NEVER included in the success response', async () => {
      registerSetupTools(server, mockKeepass, mockTransport);
      const handler = getHandler(server);
      setupHappyPath();

      const result = await handler({ ip: '192.0.2.95', identity: 'chr-95' }, {});
      const responseText = result.content[0].text;

      // Grab the password that was passed to KeePass
      const createCall = mockCreateEntry.mock.calls[0][0] as { password: string };
      const password = createCall.password;

      expect(password).toMatch(/^[a-zA-Z0-9]{40}$/);
      expect(responseText).not.toContain(password);
    });

    it('creates KeePass entry with correct fields and 40-char alphanumeric password', async () => {
      registerSetupTools(server, mockKeepass, mockTransport);
      const handler = getHandler(server);
      setupHappyPath();

      await handler({ ip: '192.0.2.95', identity: 'chr-95' }, {});

      expect(mockCreateEntry).toHaveBeenCalledOnce();
      expect(mockCreateEntry).toHaveBeenCalledWith({
        deviceId: 'chr-95',
        username: 'admin',
        hostname: '192.0.2.95',
        password: expect.stringMatching(/^[a-zA-Z0-9]{40}$/),
        notes: undefined,
      });
    });

    it('passes notes to KeePass entry when provided', async () => {
      registerSetupTools(server, mockKeepass, mockTransport);
      const handler = getHandler(server);
      setupHappyPath();

      await handler({ ip: '192.0.2.95', identity: 'chr-95', notes: 'Project notes' }, {});

      expect(mockCreateEntry).toHaveBeenCalledWith(
        expect.objectContaining({ notes: 'Project notes' }),
      );
    });

    it('sets identity via POST to /system/identity/set', async () => {
      registerSetupTools(server, mockKeepass, mockTransport);
      const handler = getHandler(server);
      setupHappyPath();

      await handler({ ip: '192.0.2.95', identity: 'chr-95' }, {});

      // First execute call on port 80 = identity set
      expect(mockPort80Execute).toHaveBeenCalledWith(
        expect.objectContaining({ hostname: '192.0.2.95', username: 'admin', password: '' }),
        '/system/identity/set',
        { name: 'chr-95' },
        { method: 'POST' },
      );
    });

    it('relocates the www service port to the configured port', async () => {
      registerSetupTools(server, mockKeepass, mockTransport);
      const handler = getHandler(server);
      setupHappyPath();

      await handler({ ip: '192.0.2.95', identity: 'chr-95' }, {});

      // Second execute call on port 80 = service port change
      const calls = mockPort80Execute.mock.calls;
      expect(calls[1]).toEqual([
        expect.objectContaining({ hostname: '192.0.2.95' }),
        '/ip/service/set',
        { '.id': '*2', port: '8080' },
        { method: 'POST' },
      ]);
    });

    it('verifies with new credentials on the target port', async () => {
      registerSetupTools(server, mockKeepass, mockTransport);
      const handler = getHandler(server);
      setupHappyPath();

      await handler({ ip: '192.0.2.95', identity: 'chr-95' }, {});

      // Last query on target port = verification with new password
      const calls = mockTargetQuery.mock.calls;
      const verifyCred = calls[calls.length - 1][0] as { password: string };
      expect(verifyCred.password).toMatch(/^[a-zA-Z0-9]{40}$/);
      expect(verifyCred.password).not.toBe('');
    });
  });

  describe('failure stages', () => {
    it('step 1 (connect) — returns recoverable failure', async () => {
      registerSetupTools(server, mockKeepass, mockTransport);
      const handler = getHandler(server);

      mockPort80Query.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await handler({ ip: '192.0.2.95', identity: 'chr-95' }, {});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual({
        success: false,
        stage: 'connect',
        identity: 'chr-95',
        ip: '192.0.2.95',
        error: 'Connection refused',
        recoverable: true,
      });
    });

    it('step 3 (identity) — returns recoverable failure', async () => {
      registerSetupTools(server, mockKeepass, mockTransport);
      const handler = getHandler(server);

      // Step 1 OK
      mockPort80Query.mockResolvedValueOnce([{ name: 'MikroTik' }]);
      // Step 3 fails
      mockPort80Execute.mockRejectedValueOnce(new Error('timeout'));

      const result = await handler({ ip: '192.0.2.95', identity: 'chr-95' }, {});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(false);
      expect(parsed.stage).toBe('identity');
      expect(parsed.recoverable).toBe(true);
    });

    it('step 4 (port-change) — www service not found', async () => {
      registerSetupTools(server, mockKeepass, mockTransport);
      const handler = getHandler(server);

      mockPort80Query.mockResolvedValueOnce([{ name: 'MikroTik' }]); // step 1
      mockPort80Execute.mockResolvedValueOnce(undefined); // step 3
      mockPort80Query.mockResolvedValueOnce([{ '.id': '*1', name: 'telnet', port: '23' }]); // step 4a — no www entry

      const result = await handler({ ip: '192.0.2.95', identity: 'chr-95' }, {});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(false);
      expect(parsed.stage).toBe('port-change');
      expect(parsed.error).toContain('www service entry not found');
      expect(parsed.recoverable).toBe(true);
    });

    it('step 4 (port-change) — tolerates connection drop when port switches', async () => {
      registerSetupTools(server, mockKeepass, mockTransport);
      const handler = getHandler(server);

      mockPort80Query.mockResolvedValueOnce([{ name: 'MikroTik' }]); // step 1
      mockPort80Execute.mockResolvedValueOnce(undefined); // step 3
      mockPort80Query.mockResolvedValueOnce([{ '.id': '*2', name: 'www', port: '80' }]); // step 4a
      // Step 4b: port change drops connection
      mockPort80Execute.mockRejectedValueOnce(new Error('connection reset'));
      // Verification on the target port succeeds
      mockTargetQuery.mockResolvedValueOnce([{ name: 'chr-95' }]);

      // Step 5
      mockTargetQuery.mockResolvedValueOnce([{ '.id': '*1', name: 'admin' }]);
      mockTargetExecute.mockResolvedValueOnce(undefined);
      // Step 6
      mockCreateEntry.mockResolvedValueOnce(undefined);
      // Step 7
      mockTargetQuery.mockResolvedValueOnce([{ name: 'chr-95' }]);

      const result = await handler({ ip: '192.0.2.95', identity: 'chr-95' }, {});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
    });

    it('step 5 (password) — returns recoverable failure', async () => {
      registerSetupTools(server, mockKeepass, mockTransport);
      const handler = getHandler(server);

      mockPort80Query.mockResolvedValueOnce([{ name: 'MikroTik' }]); // step 1
      mockPort80Execute.mockResolvedValueOnce(undefined); // step 3
      mockPort80Query.mockResolvedValueOnce([{ '.id': '*2', name: 'www', port: '80' }]); // step 4a
      mockPort80Execute.mockResolvedValueOnce(undefined); // step 4b
      // Step 5: admin user not found
      mockTargetQuery.mockResolvedValueOnce([{ '.id': '*2', name: 'guest' }]);

      const result = await handler({ ip: '192.0.2.95', identity: 'chr-95' }, {});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(false);
      expect(parsed.stage).toBe('password');
      expect(parsed.error).toContain('admin user entry not found');
      expect(parsed.recoverable).toBe(true);
    });

    it('step 6 (keepass) — returns NON-recoverable failure', async () => {
      registerSetupTools(server, mockKeepass, mockTransport);
      const handler = getHandler(server);

      mockPort80Query.mockResolvedValueOnce([{ name: 'MikroTik' }]); // step 1
      mockPort80Execute.mockResolvedValueOnce(undefined); // step 3
      mockPort80Query.mockResolvedValueOnce([{ '.id': '*2', name: 'www', port: '80' }]); // step 4a
      mockPort80Execute.mockResolvedValueOnce(undefined); // step 4b
      mockTargetQuery.mockResolvedValueOnce([{ '.id': '*1', name: 'admin' }]); // step 5a
      mockTargetExecute.mockResolvedValueOnce(undefined); // step 5b
      // Step 6 fails
      mockCreateEntry.mockRejectedValueOnce(new Error('Vault write failed'));

      const result = await handler({ ip: '192.0.2.95', identity: 'chr-95' }, {});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(false);
      expect(parsed.stage).toBe('keepass');
      expect(parsed.recoverable).toBe(false);
    });

    it('step 7 (verify) — returns non-recoverable failure', async () => {
      registerSetupTools(server, mockKeepass, mockTransport);
      const handler = getHandler(server);

      mockPort80Query.mockResolvedValueOnce([{ name: 'MikroTik' }]); // step 1
      mockPort80Execute.mockResolvedValueOnce(undefined); // step 3
      mockPort80Query.mockResolvedValueOnce([{ '.id': '*2', name: 'www', port: '80' }]); // step 4a
      mockPort80Execute.mockResolvedValueOnce(undefined); // step 4b
      mockTargetQuery.mockResolvedValueOnce([{ '.id': '*1', name: 'admin' }]); // step 5a
      mockTargetExecute.mockResolvedValueOnce(undefined); // step 5b
      mockCreateEntry.mockResolvedValueOnce(undefined); // step 6
      // Step 7 fails
      mockTargetQuery.mockRejectedValueOnce(new Error('Auth failed'));

      const result = await handler({ ip: '192.0.2.95', identity: 'chr-95' }, {});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(false);
      expect(parsed.stage).toBe('verify');
      expect(parsed.recoverable).toBe(false);
    });
  });

  describe('security', () => {
    it('password is never present in any failure response', async () => {
      registerSetupTools(server, mockKeepass, mockTransport);
      const handler = getHandler(server);

      // Force a KeePass failure that echoes the password in the error message
      mockPort80Query.mockResolvedValueOnce([{ name: 'MikroTik' }]);
      mockPort80Execute.mockResolvedValueOnce(undefined);
      mockPort80Query.mockResolvedValueOnce([{ '.id': '*2', name: 'www', port: '80' }]);
      mockPort80Execute.mockResolvedValueOnce(undefined);
      mockTargetQuery.mockResolvedValueOnce([{ '.id': '*1', name: 'admin' }]);
      mockTargetExecute.mockResolvedValueOnce(undefined);

      // Simulate KeePass error that accidentally includes the password
      mockCreateEntry.mockImplementationOnce(async (params: { password: string }) => {
        throw new Error(`Failed to write vault with password ${params.password}`);
      });

      const result = await handler({ ip: '192.0.2.95', identity: 'chr-95' }, {});
      const responseText = result.content[0].text;
      const parsed = JSON.parse(responseText);

      // Password must have been sanitized to [REDACTED]
      expect(parsed.error).toContain('[REDACTED]');
      expect(parsed.error).not.toMatch(/[a-zA-Z0-9]{40}/);
    });

    it('uses admin with empty password as initial credentials', async () => {
      registerSetupTools(server, mockKeepass, mockTransport);
      const handler = getHandler(server);

      mockPort80Query.mockRejectedValueOnce(new Error('fail'));

      await handler({ ip: '192.0.2.95', identity: 'chr-95' }, {});

      const cred = mockPort80Query.mock.calls[0][0] as { username: string; password: string };
      expect(cred.username).toBe('admin');
      expect(cred.password).toBe('');
    });
  });
});
