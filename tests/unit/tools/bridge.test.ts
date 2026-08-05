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
  parseBridgeHosts,
  parseBridgePorts,
  parseBridges,
  parseBridgeVlans,
  parseNeighbors,
  registerBridgeTools,
} from '../../../src/tools/bridge.js';

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

describe('parseBridges', () => {
  it('returns empty array for empty output', () => {
    expect(parseBridges('')).toEqual([]);
  });

  it('parses bridge detail output', () => {
    const raw =
      ' 0 name="bridge1" mac-address=AA:BB:CC:DD:EE:FF arp-timeout=auto protocol-mode=rstp vlan-filtering=yes \r\n';
    const result = parseBridges(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'bridge1',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      arpTimeout: 'auto',
      protocolMode: 'rstp',
      vlanFiltering: true,
    });
  });
});

describe('parseBridgePorts', () => {
  it('returns empty array for empty output', () => {
    expect(parseBridgePorts('')).toEqual([]);
  });

  it('parses bridge port detail output', () => {
    const raw = ' 0 interface=ether2 bridge=bridge1 pvid=1 role=designated-port hw=yes \r\n';
    const result = parseBridgePorts(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      interface: 'ether2',
      bridge: 'bridge1',
      pvid: 1,
      role: 'designated-port',
      hw: true,
    });
  });
});

describe('parseBridgeVlans', () => {
  it('returns empty array for empty output', () => {
    expect(parseBridgeVlans('')).toEqual([]);
  });

  it('parses bridge vlan detail output', () => {
    const raw = ' 0 bridge=bridge1 vlan-ids=10 tagged=bridge1,ether1 untagged=ether2 \r\n';
    const result = parseBridgeVlans(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      bridge: 'bridge1',
      vlanIds: 10,
      tagged: 'bridge1,ether1',
      untagged: 'ether2',
    });
  });
});

describe('parseBridgeHosts', () => {
  it('returns empty array for empty output', () => {
    expect(parseBridgeHosts('')).toEqual([]);
  });

  it('parses bridge host detail output', () => {
    const raw =
      ' 0 mac-address=AA:BB:CC:DD:EE:FF interface=ether2 bridge=bridge1 on-interface=ether2 \r\n';
    const result = parseBridgeHosts(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      macAddress: 'AA:BB:CC:DD:EE:FF',
      interface: 'ether2',
      bridge: 'bridge1',
      onInterface: 'ether2',
    });
  });
});

describe('parseNeighbors', () => {
  it('returns empty array for empty output', () => {
    expect(parseNeighbors('')).toEqual([]);
  });

  it('parses neighbor detail output', () => {
    const raw =
      ' 0 interface=ether1 mac-address=AA:BB:CC:00:11:22 identity="Router-2" platform="MikroTik" version="7.10" address=10.0.0.2 discovered-by=lldp \r\n';
    const result = parseNeighbors(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      interface: 'ether1',
      macAddress: 'AA:BB:CC:00:11:22',
      identity: 'Router-2',
      platform: 'MikroTik',
      version: '7.10',
      address: '10.0.0.2',
      discoveredBy: 'lldp',
    });
  });
});

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

describe('registerBridgeTools', () => {
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

  it('registers all 5 bridge/neighbor tools', () => {
    registerBridgeTools(server, mockKeepass, mockTransport);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(tools).toHaveProperty('bridge-list');
    expect(tools).toHaveProperty('bridge-ports');
    expect(tools).toHaveProperty('bridge-vlans');
    expect(tools).toHaveProperty('bridge-hosts');
    expect(tools).toHaveProperty('ip-neighbors');
  });

  for (const toolName of [
    'bridge-list',
    'bridge-ports',
    'bridge-vlans',
    'bridge-hosts',
    'ip-neighbors',
  ]) {
    it(`${toolName} handler calls fanOut and returns content`, async () => {
      registerBridgeTools(server, mockKeepass, mockTransport);
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools[toolName].handler;
      mockFanOut.mockResolvedValue([]);
      const result = await handler({ target: 'R1' }, {});
      expect(mockFanOut).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('content');
      vi.clearAllMocks();
    });
  }
});
