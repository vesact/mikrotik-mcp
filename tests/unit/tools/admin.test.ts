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
import { parseNtp, parseSnmp, registerAdminTools } from '../../../src/tools/admin.js';

describe('parseNtp', () => {
  it('parses NTP config', () => {
    const raw = '     enabled: no     \r\n        mode: unicast\r\n';
    const result = parseNtp(raw);
    expect(result.enabled).toBe(false);
    expect(result.mode).toBe('unicast');
  });
});

describe('parseSnmp', () => {
  it('parses SNMP config', () => {
    const raw = '           enabled: no            \r\n    trap-community: public        \r\n';
    const result = parseSnmp(raw);
    expect(result.enabled).toBe(false);
    expect(result.trapCommunity).toBe('public');
  });
});

describe('registerAdminTools', () => {
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

  it('registers all admin tools', () => {
    registerAdminTools(server, mockKeepass, mockTransport);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    const expected = ['system-ntp-get', 'system-snmp-get'];
    for (const name of expected) {
      expect(tools).toHaveProperty(name);
    }
  });

  for (const toolName of ['system-ntp-get', 'system-snmp-get']) {
    it(`${toolName} handler calls fanOut`, async () => {
      registerAdminTools(server, mockKeepass, mockTransport);
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
