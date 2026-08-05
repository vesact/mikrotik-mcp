import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { KeePassClient, DeviceTransport } from '../../../src/types/index.js';

const { mockListDevices, mockResolveCredentials, mockFanOut } = vi.hoisted(() => ({
  mockListDevices: vi.fn(),
  mockResolveCredentials: vi.fn(),
  mockFanOut: vi.fn(),
}));

vi.mock('../../../src/fan-out.js', () => ({ fanOut: mockFanOut }));

import {
  parsePing,
  parseTraceroute,
  parseNetwatch,
  registerDiagnosticTools,
} from '../../../src/tools/diagnostics.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('parsePing', () => {
  it('parses ping summary', () => {
    const raw =
      '  SEQ HOST                                     SIZE TTL TIME       STATUS\r\n    0 8.8.8.8                                    56  57 12ms110us  \r\n    1 8.8.8.8                                    56  57 11ms900us  \r\n    sent=4 received=4 packet-loss=0% min-rtt=11ms900us avg-rtt=12ms50us max-rtt=12ms200us\r\n';
    const result = parsePing(raw);
    expect(result.sent).toBe(4);
    expect(result.received).toBe(4);
    expect(result.packetLoss).toBe('0%');
    expect(result.minRtt).toBe('11ms900us');
  });

  it('handles empty output', () => {
    const result = parsePing('');
    expect(result.sent).toBe(0);
    expect(result.received).toBe(0);
  });
});

describe('parseTraceroute', () => {
  it('returns empty for no output', () => {
    expect(parseTraceroute('')).toEqual([]);
  });

  it('parses traceroute hops', () => {
    const raw =
      'Columns: ADDRESS, LOSS, SENT, LAST, AVG, BEST, WORST, STD-DEV\r\n#  ADDRESS   LOSS  SENT  LAST   AVG  BEST  WORST  STD-DEV\r\n0  10.0.0.2  0%       1  0.5ms  0.5  0.5   0.5          0\r\n\r\n';
    const result = parseTraceroute(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      hop: '0',
      address: '10.0.0.2',
      loss: '0%',
      lastRtt: '0.5ms',
    });
  });
});

describe('parseNetwatch', () => {
  it('returns empty for no entries', () => {
    expect(parseNetwatch('')).toEqual([]);
  });

  it('parses netwatch entry', () => {
    const raw = ' 0 host=8.8.8.8 type=icmp interval=10s status=up \r\n';
    const result = parseNetwatch(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ host: '8.8.8.8', type: 'icmp', interval: '10s', status: 'up' });
  });
});

describe('registerDiagnosticTools', () => {
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

  it('registers all 13 diagnostic tools', () => {
    registerDiagnosticTools(server, mockKeepass, mockTransport);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    const expected = [
      'tools-ping',
      'tools-traceroute',
      'tools-bandwidth-test',
      'tools-torch',
      'tools-packet-sniffer',
      'tools-profile',
      'tools-netwatch-list',
      'tools-fetch',
      'tools-speed-test',
      'tools-wol',
      'tools-mac-scan',
      'tools-ip-scan',
      'tools-traffic-gen',
    ];
    for (const name of expected) {
      expect(tools).toHaveProperty(name);
    }
  });

  for (const toolName of ['tools-ping', 'tools-netwatch-list']) {
    it(`${toolName} handler calls fanOut`, async () => {
      registerDiagnosticTools(server, mockKeepass, mockTransport);
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      mockFanOut.mockResolvedValue([]);
      const result = await tools[toolName]!.handler({ target: 'R1', address: '8.8.8.8' }, {});
      expect(mockFanOut).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('content');
      vi.clearAllMocks();
    });
  }
});
