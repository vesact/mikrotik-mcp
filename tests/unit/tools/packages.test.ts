import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { KeePassClient, DeviceTransport } from '../../../src/types/index.js';

const { mockListDevices, mockResolveCredentials, mockFanOut } = vi.hoisted(() => ({
  mockListDevices: vi.fn(),
  mockResolveCredentials: vi.fn(),
  mockExecuteCommand: vi.fn(),
  mockFanOut: vi.fn(),
}));

vi.mock('../../../src/fan-out.js', () => ({
  fanOut: mockFanOut,
}));

import {
  parsePackages,
  parseLicense,
  parseHistory,
  registerPackageTools,
} from '../../../src/tools/packages.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// --- Parser tests ---

describe('parsePackages', () => {
  it('parses package detail output', () => {
    const raw =
      'Flags: X - DISABLED; A - AVAILABLE \r\n 0    name="routeros" version="7.22.1" build-time=2026-03-23 \r\n      scheduled="" size=11.7MiB \r\n\r\n';
    const result = parsePackages(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'routeros',
      version: '7.22.1',
      buildTime: '2026-03-23',
      scheduled: null,
      size: '11.7MiB',
    });
  });

  it('returns empty array for empty output', () => {
    expect(parsePackages('')).toEqual([]);
  });

  it('parses multiple packages', () => {
    const raw =
      ' 0    name="routeros" version="7.22.1" size=11.7MiB \r\n\r\n 1    name="wireless" version="7.22.1" size=1.2MiB \r\n\r\n';
    const result = parsePackages(raw);
    expect(result).toHaveLength(2);
    expect(result[0]!['name']).toBe('routeros');
    expect(result[1]!['name']).toBe('wireless');
  });
});

describe('parseLicense', () => {
  it('parses license output with nlevel field', () => {
    const raw =
      '  software-id: EJHI-0FLT\r\n       nlevel: 4        \r\n     features:          \r\n\r\n';
    expect(parseLicense(raw)).toEqual({
      softwareId: 'EJHI-0FLT',
      nlevel: 4,
    });
  });

  it('returns empty fields for empty output', () => {
    expect(parseLicense('')).toEqual({});
  });
});

describe('parseHistory', () => {
  it('parses history detail output', () => {
    const raw =
      'Flags: U - UNDOABLE\r\n U redo=/ip action="ip service changed" \r\n    by="admin" policy=write time=2026-03-22 \r\n\r\n';
    const result = parseHistory(raw);
    expect(result).toHaveLength(1);
    expect(result[0]!.action).toBe('ip service changed');
    expect(result[0]!.by).toBe('admin');
    expect(result[0]!.policy).toBe('write');
    expect(result[0]!.time).toBe('2026-03-22');
  });

  it('returns empty array for empty output', () => {
    expect(parseHistory('')).toEqual([]);
  });
});

// --- Tool registration & handler tests ---

describe('registerPackageTools', () => {
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

  it('registers all 3 package tools', () => {
    registerPackageTools(server, mockKeepass, mockTransport);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(tools).toHaveProperty('system-packages-list');
    expect(tools).toHaveProperty('system-license-get');
    expect(tools).toHaveProperty('system-history-get');
  });

  describe('system-packages-list handler', () => {
    it('calls fanOut and returns content', async () => {
      registerPackageTools(server, mockKeepass, mockTransport);
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools['system-packages-list']!.handler;

      mockFanOut.mockResolvedValue([
        { deviceId: 'R1', success: true, data: [{ name: 'routeros', version: '7.22.1' }] },
      ]);

      const result = await handler({ target: 'R1' }, {});
      expect(mockFanOut).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('content');
    });
  });

  describe('system-license-get handler', () => {
    it('calls fanOut with correct target', async () => {
      registerPackageTools(server, mockKeepass, mockTransport);
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools['system-license-get']!.handler;

      mockFanOut.mockResolvedValue([]);
      await handler({ target: 'all' }, {});
      expect(mockFanOut).toHaveBeenCalledOnce();
      const [, target] = mockFanOut.mock.calls[0]!;
      expect(target).toBe('all');
    });
  });

  describe('system-history-get handler', () => {
    it('calls fanOut with correct target', async () => {
      registerPackageTools(server, mockKeepass, mockTransport);
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools['system-history-get']!.handler;

      mockFanOut.mockResolvedValue([]);
      await handler({ target: 'R1' }, {});
      expect(mockFanOut).toHaveBeenCalledOnce();
      const [, target] = mockFanOut.mock.calls[0]!;
      expect(target).toBe('R1');
    });
  });
});
