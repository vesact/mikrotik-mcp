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
  parseAddressList,
  parseConnections,
  parseFirewallFilter,
  parseFirewallMangle,
  parseFirewallNat,
  parseRadius,
  parseServices,
  registerFirewallTools,
} from '../../../src/tools/firewall.js';

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

describe('parseFirewallFilter', () => {
  it('returns empty array for empty output', () => {
    expect(parseFirewallFilter('Flags: X - DISABLED\r\n\r\n')).toEqual([]);
  });

  it('parses filter rule', () => {
    const raw =
      ' 0 chain=input action=accept protocol=tcp src-address=10.0.0.0/24 dst-address=0.0.0.0/0 comment="allow lan" \r\n';
    const result = parseFirewallFilter(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      chain: 'input',
      action: 'accept',
      protocol: 'tcp',
      srcAddress: '10.0.0.0/24',
      dstAddress: '0.0.0.0/0',
      comment: 'allow lan',
    });
  });
});

describe('parseFirewallNat', () => {
  it('returns empty for no rules', () => {
    expect(parseFirewallNat('')).toEqual([]);
  });

  it('parses NAT rule', () => {
    const raw = ' 0 chain=srcnat action=masquerade src-address=192.168.1.0/24 \r\n';
    const result = parseFirewallNat(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      chain: 'srcnat',
      action: 'masquerade',
      srcAddress: '192.168.1.0/24',
    });
  });
});

describe('parseFirewallMangle', () => {
  it('returns empty for no rules', () => {
    expect(parseFirewallMangle('')).toEqual([]);
  });
});

describe('parseAddressList', () => {
  it('returns empty for no entries', () => {
    expect(parseAddressList('')).toEqual([]);
  });

  it('parses address list entry', () => {
    const raw = ' 0 list=blocklist address=1.2.3.4 timeout=1d comment="bad actor" \r\n';
    const result = parseAddressList(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      list: 'blocklist',
      address: '1.2.3.4',
      timeout: '1d',
      comment: 'bad actor',
    });
  });
});

describe('parseConnections', () => {
  it('returns empty for no connections', () => {
    expect(parseConnections('Flags: E - EXPECTED\r\n\r\n')).toEqual([]);
  });
});

describe('parseServices', () => {
  it('returns empty for empty output', () => {
    expect(parseServices('')).toEqual([]);
  });

  it('parses service detail output', () => {
    const raw = ' 0     name="ssh" port=22 proto=tcp address="" \r\n';
    const result = parseServices(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'ssh', port: 22, proto: 'tcp', address: null });
  });
});

describe('parseRadius', () => {
  it('returns empty for no RADIUS entries', () => {
    expect(parseRadius('Flags: X - DISABLED\r\n\r\n')).toEqual([]);
  });

  it('does not expose secret field', () => {
    const raw =
      ' 0 service=login address=10.0.0.100 secret=mysecret authentication-port=1812 accounting-port=1813 timeout=3s \r\n';
    const result = parseRadius(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      service: 'login',
      address: '10.0.0.100',
      secret: '[REDACTED]',
      authenticationPort: 1812,
      accountingPort: 1813,
      timeout: '3s',
    });
  });
});

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

describe('registerFirewallTools', () => {
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

  it('registers all firewall/security tools', () => {
    registerFirewallTools(server, mockKeepass, mockTransport);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    const expected = [
      'firewall-filter-list',
      'firewall-nat-list',
      'firewall-mangle-list',
      'firewall-address-list',
      'firewall-connections-list',
      'ip-services-list',
      'radius-list',
    ];
    for (const name of expected) {
      expect(tools).toHaveProperty(name);
    }
  });

  for (const toolName of [
    'firewall-filter-list',
    'firewall-nat-list',
    'ip-services-list',
    'radius-list',
  ]) {
    it(`${toolName} handler calls fanOut`, async () => {
      registerFirewallTools(server, mockKeepass, mockTransport);
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
