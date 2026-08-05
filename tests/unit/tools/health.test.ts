import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { KeePassClient, ToolDeps } from '../../../src/types/index.js';

// --- Hoisted mock fns ---

const { mockListDevices, mockResolveCredentials, mockFanOut } = vi.hoisted(() => ({
  mockListDevices: vi.fn(),
  mockResolveCredentials: vi.fn(),
  mockExecuteCommand: vi.fn(),
  mockFanOut: vi.fn(),
}));

// --- Module mocks ---

vi.mock('../../../src/fan-out.js', () => ({
  fanOut: mockFanOut,
}));

// --- Imports (after mocks) ---

import {
  parseHealth,
  parseRouterboard,
  parseWatchdog,
  registerHealthTools,
} from '../../../src/tools/health.js';
import { parseDetailRecords } from '../../../src/tools/system.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// --- parseDetailRecords tests ---

describe('parseDetailRecords', () => {
  it('parses multi-record detail output', () => {
    const raw =
      ' 0    name="voltage" value=24.4 type=V \r\n\r\n 1    name="cpu-temperature" value=63 type=C \r\n\r\n';
    const records = parseDetailRecords(raw);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({ name: 'voltage', value: '24.4', type: 'V' });
    expect(records[1]).toEqual({ name: 'cpu-temperature', value: '63', type: 'C' });
  });

  it('parses single record with quoted and unquoted values', () => {
    const raw =
      'Flags: X - DISABLED\r\n 0    name="routeros" version="7.22.1" build-time=2025-01-15 size=11.7MiB \r\n\r\n';
    const records = parseDetailRecords(raw);
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      name: 'routeros',
      version: '7.22.1',
      'build-time': '2025-01-15',
      size: '11.7MiB',
    });
  });

  it('returns empty array for empty output', () => {
    expect(parseDetailRecords('')).toEqual([]);
    expect(parseDetailRecords('\r\n')).toEqual([]);
  });

  it('skips Flags and Columns header lines', () => {
    const raw =
      'Flags: K - PRIVATE-KEY\r\nColumns: NAME, VALUE\r\n 0    name="test" value=1 \r\n\r\n';
    const records = parseDetailRecords(raw);
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({ name: 'test', value: '1' });
  });

  it('handles multi-line records (continuation lines)', () => {
    const raw =
      ' 0   name=auto-before-reset.backup type=backup size=25.2KiB \r\n     last-modified=1970-01-01 \r\n\r\n';
    const records = parseDetailRecords(raw);
    expect(records).toHaveLength(1);
    expect(records[0].name).toBe('auto-before-reset.backup');
    expect(records[0].type).toBe('backup');
    expect(records[0].size).toBe('25.2KiB');
  });
});

// --- Parser tests ---

describe('parseHealth', () => {
  it('parses health detail output into structured entries', () => {
    const raw =
      ' 0    name="voltage" value=24.4 type=V \r\n\r\n 1    name="cpu-temperature" value=63 type=C \r\n\r\n 2    name="board-temperature1" value=49 type=C \r\n\r\n';
    const result = parseHealth(raw);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ name: 'voltage', value: '24.4', type: 'V' });
    expect(result[1]).toEqual({ name: 'cpu-temperature', value: 63, type: 'C' });
    expect(result[2]).toEqual({ name: 'board-temperature1', value: 49, type: 'C' });
  });

  it('returns empty array for empty output (CHR/virtual)', () => {
    expect(parseHealth('')).toEqual([]);
  });
});

describe('parseRouterboard', () => {
  it('parses routerboard output', () => {
    const raw = [
      '       routerboard: yes        \r',
      '        board-name: hEX        \r',
      '             model: E50UG      \r',
      '     serial-number: TESTSERIAL01\r',
      '     firmware-type: en7562     \r',
      '  current-firmware: 7.16.0     \r',
      '  upgrade-firmware: 7.22.1     \r',
    ].join('\n');
    expect(parseRouterboard(raw)).toEqual({
      routerboard: true,
      boardName: 'hEX',
      model: 'E50UG',
      serialNumber: 'TESTSERIAL01',
      firmwareType: 'en7562',
      currentFirmware: '7.16.0',
      upgradeFirmware: '7.22.1',
    });
  });

  it('returns empty fields for CHR (no routerboard)', () => {
    const raw = '       routerboard: no\r\n';
    expect(parseRouterboard(raw)).toEqual({
      routerboard: false,
    });
  });
});

describe('parseWatchdog', () => {
  it('parses watchdog output', () => {
    const raw = [
      '          watch-address: none\r',
      '         watchdog-timer: yes \r',
      '  ping-start-after-boot: 5m  \r',
      '           ping-timeout: 1m  \r',
      '       automatic-supout: yes \r',
    ].join('\n');
    expect(parseWatchdog(raw)).toEqual({
      watchAddress: 'none',
      watchdogTimer: true,
      pingStartAfterBoot: '5m',
      pingTimeout: '1m',
      automaticSupout: true,
    });
  });

  it('returns empty for empty output', () => {
    expect(parseWatchdog('')).toEqual({});
  });
});

// --- Tool registration & handler tests ---

describe('registerHealthTools', () => {
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

  it('registers all 3 health tools', () => {
    registerHealthTools(server, mockKeepass, mockTransport);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(tools).toHaveProperty('system-health-get');
    expect(tools).toHaveProperty('system-routerboot-get');
    expect(tools).toHaveProperty('system-watchdog-get');
  });

  describe('system-health-get handler', () => {
    it('calls fanOut and returns parsed results', async () => {
      registerHealthTools(server, mockKeepass, mockTransport);
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools['system-health-get'].handler;

      mockFanOut.mockResolvedValue([
        {
          deviceId: 'Router-01',
          success: true,
          data: [{ name: 'voltage', value: '24.4', type: 'V' }],
        },
      ]);

      const result = await handler({ target: 'Router-01' }, {});
      expect(mockFanOut).toHaveBeenCalledOnce();

      const [deps, target] = mockFanOut.mock.calls[0];
      expect(target).toBe('Router-01');
      expect((deps as ToolDeps).sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      expect(result).toHaveProperty('content');
    });
  });

  describe('system-routerboot-get handler', () => {
    it('calls fanOut with correct target', async () => {
      registerHealthTools(server, mockKeepass, mockTransport);
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools['system-routerboot-get'].handler;

      mockFanOut.mockResolvedValue([{ deviceId: 'Router-01', success: true, data: {} }]);

      await handler({ target: 'all' }, {});
      expect(mockFanOut).toHaveBeenCalledOnce();

      const [, target] = mockFanOut.mock.calls[0];
      expect(target).toBe('all');
    });
  });

  describe('system-watchdog-get handler', () => {
    it('calls fanOut with correct target', async () => {
      registerHealthTools(server, mockKeepass, mockTransport);
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools['system-watchdog-get'].handler;

      mockFanOut.mockResolvedValue([{ deviceId: 'Router-01', success: true, data: {} }]);

      await handler({ target: 'Router-01' }, {});
      expect(mockFanOut).toHaveBeenCalledOnce();

      const [, target] = mockFanOut.mock.calls[0];
      expect(target).toBe('Router-01');
    });
  });
});
