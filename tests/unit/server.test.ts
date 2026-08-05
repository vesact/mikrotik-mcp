import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mock fns (available inside vi.mock factories) ---

const { mockOpen, mockListDevices, mockResolveCredentials, mockExecuteCommand, mockFanOut } =
  vi.hoisted(() => ({
    mockOpen: vi.fn(),
    mockListDevices: vi.fn(),
    mockResolveCredentials: vi.fn(),
    mockExecuteCommand: vi.fn(),
    mockFanOut: vi.fn(),
  }));

// --- Module mocks ---

vi.mock('../../src/keepass/keepass-client.js', () => ({
  KeePassClientImpl: class MockKeePassClient {
    open = mockOpen;
    listDevices = mockListDevices;
    resolveCredentials = mockResolveCredentials;
  },
}));

vi.mock('../../src/ssh/ssh-transport.js', () => ({
  SshTransportImpl: class MockSshTransport {
    executeCommand = mockExecuteCommand;
    query = vi.fn();
    execute = vi.fn();
    raw = vi.fn();
  },
}));

vi.mock('../../src/rest/rest-transport.js', () => ({
  RestTransportImpl: class MockRestTransport {
    query = vi.fn();
    execute = vi.fn();
    raw = vi.fn();
  },
}));

vi.mock('../../src/fan-out.js', () => ({
  fanOut: mockFanOut,
}));

// --- Imports (after mocks) ---

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServer } from '../../src/server.js';
import type { ToolDeps } from '../../src/types/index.js';

describe('createServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpen.mockResolvedValue(undefined);
    mockListDevices.mockResolvedValue([]);
    mockFanOut.mockResolvedValue([]);
  });

  it('returns an McpServer instance when vault opens successfully', async () => {
    const server = await createServer();
    expect(server).toBeInstanceOf(McpServer);
  });

  it('calls keepass.open() at startup (fail-fast)', async () => {
    await createServer();
    expect(mockOpen).toHaveBeenCalledOnce();
  });

  it('rejects when vault open fails', async () => {
    mockOpen.mockRejectedValue(new Error('Invalid credentials'));
    await expect(createServer()).rejects.toThrow('Invalid credentials');
  });

  describe('device-list tool', () => {
    it('is registered on the server', async () => {
      const server = await createServer();
      const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
        ._registeredTools;
      expect(tools).toHaveProperty('device-list');
    });

    it('returns device IDs and hostnames without passwords', async () => {
      const server = await createServer();
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools['device-list'].handler;

      mockListDevices.mockResolvedValue([
        { deviceId: 'Router-01', hostname: '10.0.0.1', username: 'admin', password: 'secret123' },
        { deviceId: 'Router-02', hostname: '10.0.0.2', username: 'admin', password: 'secret456' },
      ]);

      const result = (await handler({}, {})) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text) as Array<Record<string, string>>;

      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toEqual({ deviceId: 'Router-01', hostname: '10.0.0.1', username: 'admin' });
      expect(parsed[1]).toEqual({ deviceId: 'Router-02', hostname: '10.0.0.2', username: 'admin' });
      // Password MUST NOT be present
      expect(parsed[0]).not.toHaveProperty('password');
      expect(parsed[1]).not.toHaveProperty('password');
    });
  });

  describe('READ_ONLY mode', () => {
    const READ_ONLY_TOOL_NAMES = [
      'device-list',
      'bridge-hosts',
      'bridge-list',
      'bridge-ports',
      'bridge-vlans',
      'dhcp-client-list',
      'dhcp-server-leases',
      'dhcp-server-list',
      'dhcp-server-networks',
      'dns-get',
      'dns-static-list',
      'firewall-address-list',
      'firewall-connections-list',
      'firewall-filter-list',
      'firewall-mangle-list',
      'firewall-nat-list',
      'interface-list',
      'interface-lists',
      'interface-stats',
      'ip-address-list',
      'ip-arp-list',
      'ip-neighbors',
      'ip-pool-list',
      'ip-routes-list',
      'ip-services-list',
      'ip-settings-get',
      'ppp-aaa-get',
      'ppp-active-list',
      'ppp-profiles-list',
      'ppp-secrets-list',
      'radius-list',
      'files-list',
      'log-get',
      'tools-netwatch-list',
      'system-certificates-list',
      'system-clock-get',
      'system-health-get',
      'system-history-get',
      'system-identity-get',
      'system-license-get',
      'system-logging-list',
      'system-note-get',
      'system-ntp-get',
      'system-packages-list',
      'system-routerboot-get',
      'system-scheduler-list',
      'system-scripts-list',
      'system-snmp-get',
      'system-users-list',
      'system-watchdog-get',
      'system-lcd-get',
    ];

    const EXCLUDED_TOOL_NAMES = [
      'ros-command',
      'setup-new-device',
      'tools-ping',
      'tools-traceroute',
      'tools-profile',
      'tools-torch',
      'tools-ip-scan',
      'tools-mac-scan',
      'tools-fetch',
      'tools-bandwidth-test',
      'tools-speed-test',
      'tools-wol',
      'tools-packet-sniffer',
      'tools-traffic-gen',
    ];

    const getTools = (server: unknown): Record<string, unknown> =>
      (server as { _registeredTools: Record<string, unknown> })._registeredTools;

    afterEach(() => {
      delete process.env.READ_ONLY;
    });

    it('registers all tools when READ_ONLY is unset (default behavior)', async () => {
      delete process.env.READ_ONLY;
      const server = await createServer();
      const tools = getTools(server);
      for (const name of [...READ_ONLY_TOOL_NAMES, ...EXCLUDED_TOOL_NAMES]) {
        expect(tools, `expected default mode to register ${name}`).toHaveProperty(name);
      }
    });

    it('registers all tools when READ_ONLY=false', async () => {
      process.env.READ_ONLY = 'false';
      const server = await createServer();
      const tools = getTools(server);
      expect(tools).toHaveProperty('ros-command');
      expect(tools).toHaveProperty('tools-ping');
    });

    it('exposes exactly the read-only allow-list when READ_ONLY=true', async () => {
      process.env.READ_ONLY = 'true';
      const server = await createServer();
      const registered = Object.keys(getTools(server)).sort();
      expect(registered).toEqual([...READ_ONLY_TOOL_NAMES].sort());
    });

    it('withholds all write/execution and active diagnostic tools when READ_ONLY=true', async () => {
      process.env.READ_ONLY = 'true';
      const server = await createServer();
      const tools = getTools(server);
      for (const name of EXCLUDED_TOOL_NAMES) {
        expect(tools, `expected ${name} to be withheld in read-only mode`).not.toHaveProperty(name);
      }
    });

    it('keeps the read-only netwatch tool but drops the active diagnostics from the same module', async () => {
      process.env.READ_ONLY = 'true';
      const server = await createServer();
      const tools = getTools(server);
      expect(tools).toHaveProperty('tools-netwatch-list');
      expect(tools).not.toHaveProperty('tools-ping');
      expect(tools).not.toHaveProperty('tools-torch');
    });

    it.each(['1', 'yes', 'on', 'TRUE', 'True', ' true '])(
      'treats %j as enabling read-only mode',
      async (value) => {
        process.env.READ_ONLY = value;
        const server = await createServer();
        const tools = getTools(server);
        expect(tools).not.toHaveProperty('ros-command');
        expect(tools).toHaveProperty('device-list');
      },
    );

    it.each(['0', 'no', 'off', 'false', ''])(
      'treats %j as NOT enabling read-only mode',
      async (value) => {
        process.env.READ_ONLY = value;
        const server = await createServer();
        const tools = getTools(server);
        expect(tools).toHaveProperty('ros-command');
      },
    );
  });

  describe('ros-command tool', () => {
    it('is registered on the server', async () => {
      const server = await createServer();
      const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
        ._registeredTools;
      expect(tools).toHaveProperty('ros-command');
    });

    it('calls fanOut with correct target and command', async () => {
      const server = await createServer();
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools['ros-command'].handler;

      mockFanOut.mockResolvedValue([
        { deviceId: 'Router-01', success: true, data: 'identity: MikroTik' },
      ]);

      await handler({ target: 'Router-01', command: '/system/identity/print' }, {});

      expect(mockFanOut).toHaveBeenCalledOnce();
      const [deps, target, callback] = mockFanOut.mock.calls[0];
      expect(target).toBe('Router-01');
      expect(deps).toHaveProperty('sessionId');
      expect(deps).toHaveProperty('keepass');
      expect(deps).toHaveProperty('transport');
      expect(typeof callback).toBe('function');
    });

    it('generates unique sessionId per tool invocation', async () => {
      const server = await createServer();
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools['ros-command'].handler;

      mockFanOut.mockResolvedValue([]);

      await handler({ target: 'all', command: '/system/identity/print' }, {});
      await handler({ target: 'all', command: '/ip/address/print' }, {});

      expect(mockFanOut).toHaveBeenCalledTimes(2);
      const sessionId1 = (mockFanOut.mock.calls[0][0] as ToolDeps).sessionId;
      const sessionId2 = (mockFanOut.mock.calls[1][0] as ToolDeps).sessionId;
      expect(sessionId1).not.toBe(sessionId2);
      // Verify UUID v4 format
      expect(sessionId1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('returns DeviceResult[] as JSON content', async () => {
      const server = await createServer();
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools['ros-command'].handler;

      const mockResults = [
        { deviceId: 'Router-01', success: true, data: 'identity: MikroTik' },
        { deviceId: 'Router-02', success: false, error: 'Connection refused' },
      ];
      mockFanOut.mockResolvedValue(mockResults);

      const result = await handler({ target: 'all', command: '/system/identity/print' }, {});

      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(mockResults, null, 2) }],
      });
    });
  });
});
