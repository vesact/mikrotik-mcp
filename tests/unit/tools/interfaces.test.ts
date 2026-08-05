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
  parseInterfaces,
  parseInterfaceStats,
  parseInterfaceListMembers,
  registerInterfaceTools,
} from '../../../src/tools/interfaces.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('parseInterfaces', () => {
  it('parses interface detail output with full detail fields', () => {
    const raw = [
      'Flags: D - DYNAMIC; X - DISABLED; R - RUNNING; S - SLAVE',
      ' 0    S  name="ether1" default-name="ether1" type="ether" mtu=1500',
      '         actual-mtu=1500 mac-address=AA:BB:CC:DD:EE:02 link-downs=0',
      '',
      ' 1   RS  name="ether2" default-name="ether2" type="ether" mtu=1500',
      '         actual-mtu=1500 mac-address=AA:BB:CC:DD:EE:03',
      '',
    ].join('\r\n');
    const result = parseInterfaces(raw);
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe('ether1');
    expect(result[0]!.type).toBe('ether');
    expect(result[0]!.macAddress).toBe('AA:BB:CC:DD:EE:02');
    expect(result[1]!.name).toBe('ether2');
  });

  it('returns empty for empty output', () => {
    expect(parseInterfaces('')).toEqual([]);
  });
});

describe('parseInterfaceStats', () => {
  it('parses stats-detail output with space-in-numbers', () => {
    const raw = [
      'Flags: D - DYNAMIC; R - RUNNING; S - SLAVE;',
      'P - PASSTHROUGH',
      ' 0    S  name="ether1" link-downs=0 rx-byte=0 tx-byte=0 rx-packet=0 tx-packet=0',
      '         rx-drop=0 tx-drop=0 tx-queue-drop=0 rx-error=0 tx-error=0',
      '',
      ' 1   RS  name="ether2" link-downs=2 rx-byte=8 875 233',
      '         tx-byte=66 635 048 rx-packet=4 381 tx-packet=80 985 tx-queue-drop=0',
      '         rx-drop=0 tx-drop=0 rx-error=0 tx-error=0',
      '',
    ].join('\r\n');
    const result = parseInterfaceStats(raw);
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe('ether1');
    expect(result[0]!.rxBytes).toBe('0');
    expect(result[0]!.txBytes).toBe('0');
    expect(result[1]!.name).toBe('ether2');
    expect(result[1]!.rxBytes).toBe('8875233');
    expect(result[1]!.txBytes).toBe('66635048');
    expect(result[1]!.rxPackets).toBe('4381');
  });

  it('returns empty for empty output', () => {
    expect(parseInterfaceStats('')).toEqual([]);
  });
});

describe('parseInterfaceListMembers', () => {
  it('parses list member detail output', () => {
    const raw = [
      'Flags: X - DISABLED, D - DYNAMIC',
      ' 0   list=LAN interface=ether1 dynamic=no',
      '',
      ' 1   list=LAN interface=ether2 dynamic=no',
      '',
    ].join('\r\n');
    const result = parseInterfaceListMembers(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ list: 'LAN', interface: 'ether1', dynamic: false });
    expect(result[1]).toEqual({ list: 'LAN', interface: 'ether2', dynamic: false });
  });

  it('returns empty for empty output', () => {
    expect(parseInterfaceListMembers('')).toEqual([]);
  });
});

describe('registerInterfaceTools', () => {
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

  it('registers all 5 interface tools', () => {
    registerInterfaceTools(server, mockKeepass, mockTransport);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(tools).toHaveProperty('interface-list');
    expect(tools).toHaveProperty('interface-stats');
    expect(tools).toHaveProperty('interface-lists');
  });

  describe('interface-list handler', () => {
    it('calls fanOut and returns content', async () => {
      registerInterfaceTools(server, mockKeepass, mockTransport);
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools['interface-list']!.handler;
      mockFanOut.mockResolvedValue([]);
      const result = await handler({ target: 'R1' }, {});
      expect(mockFanOut).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('content');
    });
  });
});
