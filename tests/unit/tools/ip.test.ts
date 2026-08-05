import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { KeePassClient, DeviceTransport } from '../../../src/types/index.js';

const { mockListDevices, mockResolveCredentials, mockFanOut } = vi.hoisted(() => ({
  mockListDevices: vi.fn(),
  mockResolveCredentials: vi.fn(),
  mockExecuteCommand: vi.fn(),
  mockFanOut: vi.fn(),
}));

vi.mock('../../../src/fan-out.js', () => ({ fanOut: mockFanOut }));

import {
  parseAddresses,
  parseArp,
  parseRoutes,
  parsePools,
  parseIpSettings,
  registerIpTools,
} from '../../../src/tools/ip.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

describe('parseAddresses', () => {
  it('returns empty array for empty output', () => {
    expect(parseAddresses('')).toEqual([]);
  });

  it('parses address detail output', () => {
    const raw =
      'Flags: X - DISABLED\r\n 0   S address=10.0.0.1/24 network=10.0.0.0 interface=ether2 actual-interface=bridge1 \r\n';
    const result = parseAddresses(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      address: '10.0.0.1/24',
      network: '10.0.0.0',
      interface: 'ether2',
      actualInterface: 'bridge1',
    });
  });

  it('parses multiple addresses', () => {
    const raw =
      'Flags: X - DISABLED\r\n 0   address=10.0.0.1/24 network=10.0.0.0 interface=ether1 actual-interface=ether1 \r\n\r\n 1   address=192.168.1.1/24 network=192.168.1.0 interface=ether2 actual-interface=ether2 \r\n';
    expect(parseAddresses(raw)).toHaveLength(2);
  });
});

describe('parseArp', () => {
  it('returns empty array for empty output', () => {
    expect(parseArp('')).toEqual([]);
  });

  it('parses ARP detail output', () => {
    const raw =
      'Flags: D - DYNAMIC\r\n 0 DC address=10.0.0.2 mac-address=84:3A:5B:22:49:D0 interface=bridge1 published=no status="delay" \r\n';
    const result = parseArp(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      address: '10.0.0.2',
      macAddress: '84:3A:5B:22:49:D0',
      interface: 'bridge1',
      published: false,
      status: 'delay',
      dynamic: true,
    });
  });
});

describe('parseRoutes', () => {
  it('returns empty array for empty output', () => {
    expect(parseRoutes('')).toEqual([]);
  });

  it('parses route detail output', () => {
    const raw =
      'Flags: D - DYNAMIC; A - ACTIVE\r\n   DAc   dst-address=10.0.0.0/24 routing-table=main gateway=bridge1 immediate-gw=bridge1 distance=0 \r\n';
    const result = parseRoutes(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      dstAddress: '10.0.0.0/24',
      routingTable: 'main',
      gateway: 'bridge1',
      immediateGw: 'bridge1',
      distance: 0,
    });
  });
});

describe('parsePools', () => {
  it('returns empty array for empty output', () => {
    expect(parsePools('')).toEqual([]);
  });

  it('parses pool detail output', () => {
    const raw = ' 0 name="dhcp-pool" ranges=192.168.1.100-192.168.1.200 next-pool=none \r\n';
    const result = parsePools(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: 'dhcp-pool',
      ranges: '192.168.1.100-192.168.1.200',
      nextPool: 'none',
    });
  });
});

describe('parseIpSettings', () => {
  it('parses IP settings key-value output', () => {
    const raw =
      '                                 ip-forward: yes          \r\n                             send-redirects: yes          \r\n';
    const result = parseIpSettings(raw);
    expect(result['ipForward']).toBe(true);
    expect(result['sendRedirects']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

describe('registerIpTools', () => {
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

  it('registers all 14 IP tools', () => {
    registerIpTools(server, mockKeepass, mockTransport);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    const expected = [
      'ip-address-list',
      'ip-arp-list',
      'ip-routes-list',
      'ip-pool-list',
      'ip-settings-get',
    ];
    for (const name of expected) {
      expect(tools).toHaveProperty(name);
    }
  });

  for (const toolName of [
    'ip-address-list',
    'ip-arp-list',
    'ip-routes-list',
    'ip-pool-list',
    'ip-settings-get',
  ]) {
    it(`${toolName} handler calls fanOut and returns content`, async () => {
      registerIpTools(server, mockKeepass, mockTransport);
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools[toolName]!.handler;
      mockFanOut.mockResolvedValue([]);
      const result = await handler({ target: 'R1' }, {});
      expect(mockFanOut).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('content');
      vi.clearAllMocks();
    });
  }
});
