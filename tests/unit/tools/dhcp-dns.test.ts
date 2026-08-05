import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceTransport, KeePassClient } from '../../../src/types/index.js';

const { mockListDevices, mockResolveCredentials, mockFanOut } = vi.hoisted(() => ({
  mockListDevices: vi.fn(),
  mockResolveCredentials: vi.fn(),
  mockExecuteCommand: vi.fn(),
  mockFanOut: vi.fn(),
}));

vi.mock('../../../src/fan-out.js', () => ({ fanOut: mockFanOut }));

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  parseDhcpClient,
  parseDhcpLeases,
  parseDhcpNetworks,
  parseDhcpServer,
  parseDns,
  parseDnsStatic,
  registerDhcpDnsTools,
} from '../../../src/tools/dhcp-dns.js';

describe('parseDhcpClient', () => {
  it('returns empty for no clients', () => {
    expect(parseDhcpClient('')).toEqual([]);
  });

  it('parses DHCP client entry', () => {
    const raw = ' 0   name="bridge1" interface=bridge1 status=searching... \r\n';
    const result = parseDhcpClient(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'bridge1', interface: 'bridge1', status: 'searching...' });
  });
});

describe('parseDhcpServer', () => {
  it('returns empty for no servers', () => {
    expect(parseDhcpServer('Flags: X\r\n\r\n')).toEqual([]);
  });

  it('parses DHCP server entry', () => {
    const raw = ' 0 name="dhcp1" interface=bridge1 lease-time=10m \r\n';
    const result = parseDhcpServer(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'dhcp1', interface: 'bridge1', leaseTime: '10m' });
  });
});

describe('parseDhcpLeases', () => {
  it('returns empty for no leases', () => {
    expect(parseDhcpLeases('')).toEqual([]);
  });

  it('parses lease entry', () => {
    const raw =
      ' 0 D address=192.168.1.100 mac-address=AA:BB:CC:DD:EE:FF host-name="laptop" expires-after=8m30s \r\n';
    const result = parseDhcpLeases(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      address: '192.168.1.100',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      hostName: 'laptop',
      expiresAfter: '8m30s',
    });
  });
});

describe('parseDhcpNetworks', () => {
  it('returns empty for no networks', () => {
    expect(parseDhcpNetworks('')).toEqual([]);
  });
});

describe('parseDns', () => {
  it('parses DNS key-value output', () => {
    const raw =
      '                      servers:        \r\n        allow-remote-requests: no     \r\n';
    const result = parseDns(raw);
    expect(result.allowRemoteRequests).toBe(false);
  });
});

describe('parseDnsStatic', () => {
  it('returns empty for no entries', () => {
    expect(parseDnsStatic('Flags: D\r\n\r\n')).toEqual([]);
  });

  it('parses static DNS entry', () => {
    const raw = ' 0 name="router.local" address=10.0.0.1 ttl=1d type=A \r\n';
    const result = parseDnsStatic(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'router.local', address: '10.0.0.1', ttl: '1d', type: 'A' });
  });
});

describe('registerDhcpDnsTools', () => {
  let server: McpServer;
  let mockKeepass: KeePassClient;
  let mockTransport: DeviceTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpServer({ name: 'test', version: '1.0.0' });
    mockKeepass = { listDevices: mockListDevices, resolveCredentials: mockResolveCredentials };
    mockTransport = { query: vi.fn(), execute: vi.fn(), raw: vi.fn() };
    mockFanOut.mockResolvedValue([]);
  });

  it('registers all DHCP & DNS tools', () => {
    registerDhcpDnsTools(server, mockKeepass, mockTransport);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    const expected = [
      'dhcp-client-list',
      'dhcp-server-list',
      'dhcp-server-leases',
      'dhcp-server-networks',
      'dns-get',
      'dns-static-list',
    ];
    for (const name of expected) {
      expect(tools).toHaveProperty(name);
    }
  });

  for (const toolName of ['dhcp-client-list', 'dhcp-server-list', 'dns-get', 'dns-static-list']) {
    it(`${toolName} handler calls fanOut`, async () => {
      registerDhcpDnsTools(server, mockKeepass, mockTransport);
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      mockFanOut.mockResolvedValue([]);
      const result = await tools[toolName].handler({ target: 'R1' }, {});
      expect(mockFanOut).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('content');
      vi.clearAllMocks();
    });
  }
});
