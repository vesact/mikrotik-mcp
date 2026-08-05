import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { KeePassClient, ToolDeps } from '../../../src/types/index.js';

// --- Hoisted mock fns ---

const { mockOpen, mockListDevices, mockResolveCredentials, mockExecuteCommand, mockFanOut } =
  vi.hoisted(() => ({
    mockOpen: vi.fn(),
    mockListDevices: vi.fn(),
    mockResolveCredentials: vi.fn(),
    mockExecuteCommand: vi.fn(),
    mockFanOut: vi.fn(),
  }));

// --- Module mocks ---

vi.mock('../../../src/keepass/keepass-client.js', () => ({
  KeePassClientImpl: class MockKeePassClient {
    open = mockOpen;
    listDevices = mockListDevices;
    resolveCredentials = mockResolveCredentials;
  },
}));

vi.mock('../../../src/ssh/ssh-transport.js', () => ({
  SshTransportImpl: class MockSshTransport {
    executeCommand = mockExecuteCommand;
  },
}));

vi.mock('../../../src/fan-out.js', () => ({
  fanOut: mockFanOut,
}));

// --- Imports (after mocks) ---

import {
  parseKeyValue,
  parseIdentity,
  parseClock,
  registerSystemTools,
} from '../../../src/tools/system.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// --- Parser tests (pure functions, no mocking) ---

describe('parseKeyValue', () => {
  it('parses standard RouterOS key-value output', () => {
    const raw = '                  name: MikroTik\n';
    expect(parseKeyValue(raw)).toEqual({ name: 'MikroTik' });
  });

  it('parses multi-line output', () => {
    const raw = [
      '                  time: 12:34:56',
      '                  date: apr/19/2026',
      '    time-zone-autodetect: yes',
      '        time-zone-name: Europe/Paris',
      '            gmt-offset: +02:00',
      '            dst-active: yes',
    ].join('\n');
    expect(parseKeyValue(raw)).toEqual({
      time: '12:34:56',
      date: 'apr/19/2026',
      'time-zone-autodetect': 'yes',
      'time-zone-name': 'Europe/Paris',
      'gmt-offset': '+02:00',
      'dst-active': 'yes',
    });
  });

  it('returns empty object for empty string', () => {
    expect(parseKeyValue('')).toEqual({});
  });

  it('handles values with colons (e.g. time values)', () => {
    const raw = '   time: 12:34:56\n';
    expect(parseKeyValue(raw)).toEqual({ time: '12:34:56' });
  });

  it('skips lines without a colon separator', () => {
    const raw = 'some-header\n   name: test\n';
    expect(parseKeyValue(raw)).toEqual({ name: 'test' });
  });
});

describe('parseIdentity', () => {
  it('extracts name from identity output', () => {
    const raw = '                  name: MikroTik-CHR\n';
    expect(parseIdentity(raw)).toEqual({ name: 'MikroTik-CHR' });
  });

  it('handles identity with spaces', () => {
    const raw = '                  name: My Router 01\n';
    expect(parseIdentity(raw)).toEqual({ name: 'My Router 01' });
  });

  it('returns empty name when field missing', () => {
    expect(parseIdentity('')).toEqual({});
  });
});

describe('parseClock', () => {
  it('extracts time, date, and timezone from clock output', () => {
    const raw = [
      '                  time: 14:30:00',
      '                  date: apr/19/2026',
      '    time-zone-autodetect: yes',
      '        time-zone-name: Europe/Paris',
      '            gmt-offset: +02:00',
      '            dst-active: yes',
    ].join('\n');
    const result = parseClock(raw);
    expect(result).toEqual({
      time: '14:30:00',
      date: 'apr/19/2026',
      timeZoneAutodetect: true,
      timeZoneName: 'Europe/Paris',
      gmtOffset: '+02:00',
      dstActive: true,
    });
  });

  it('returns empty fields when output is empty', () => {
    expect(parseClock('')).toEqual({});
  });
});

// --- Tool registration & handler tests ---

describe('registerSystemTools', () => {
  let server: McpServer;
  let mockKeepass: KeePassClient;
  let mockTransport: DeviceTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpServer({ name: 'test', version: '1.0.0' });
    mockKeepass = {
      listDevices: mockListDevices,
      resolveCredentials: mockResolveCredentials,
    };
    mockTransport = { query: vi.fn(), execute: vi.fn(), raw: vi.fn() };
    mockFanOut.mockResolvedValue([]);
  });

  it('registers all 4 system tools', () => {
    registerSystemTools(server, mockKeepass, mockTransport);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(tools).toHaveProperty('system-identity-get');
    expect(tools).toHaveProperty('system-clock-get');
  });

  describe('system-identity-get handler', () => {
    it('calls fanOut and returns parsed results', async () => {
      registerSystemTools(server, mockKeepass, mockTransport);
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools['system-identity-get']!.handler;

      mockFanOut.mockResolvedValue([
        { deviceId: 'Router-01', success: true, data: { name: 'MikroTik-CHR' } },
      ]);

      const result = await handler({ target: 'Router-01' }, {});
      expect(mockFanOut).toHaveBeenCalledOnce();

      const [deps, target] = mockFanOut.mock.calls[0]!;
      expect(target).toBe('Router-01');
      expect((deps as ToolDeps).sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              [{ deviceId: 'Router-01', success: true, data: { name: 'MikroTik-CHR' } }],
              null,
              2,
            ),
          },
        ],
      });
    });
  });

  describe('system-clock-get handler', () => {
    it('calls fanOut and returns parsed clock data', async () => {
      registerSystemTools(server, mockKeepass, mockTransport);
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools['system-clock-get']!.handler;

      mockFanOut.mockResolvedValue([
        {
          deviceId: 'Router-01',
          success: true,
          data: { time: '14:30:00', date: 'apr/19/2026', timeZoneName: 'Europe/Paris' },
        },
      ]);

      const result = await handler({ target: 'all' }, {});
      expect(mockFanOut).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('content');
    });
  });
});
