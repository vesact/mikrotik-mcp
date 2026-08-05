import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { KeePassClient, DeviceTransport } from '../../../src/types/index.js';

const { mockListDevices, mockResolveCredentials, mockFanOut } = vi.hoisted(() => ({
  mockListDevices: vi.fn(),
  mockResolveCredentials: vi.fn(),
  mockExecuteCommand: vi.fn(),
  mockFanOut: vi.fn(),
}));

vi.mock('../../../src/fan-out.js', () => ({ fanOut: mockFanOut }));

import { parseLog, parseFiles, registerLogTools } from '../../../src/tools/log.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('parseLog', () => {
  it('parses log output from real device', () => {
    const raw = [
      ' 2026-03-22 14:35:18 system,info installed system-7.22.1',
      ' 2026-03-22 14:35:18 system,info router rebooted',
      ' 2026-03-22 14:35:18 interface,info lo link up',
    ].join('\r\n');
    const result = parseLog(raw);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      time: '2026-03-22 14:35:18',
      topics: 'system,info',
      message: 'installed system-7.22.1',
    });
    expect(result[2]).toEqual({
      time: '2026-03-22 14:35:18',
      topics: 'interface,info',
      message: 'lo link up',
    });
  });

  it('returns empty array for empty output', () => {
    expect(parseLog('')).toEqual([]);
  });

  it('skips non-matching lines', () => {
    const raw = 'some header\n 2026-03-22 14:35:18 system,info test\n\n';
    const result = parseLog(raw);
    expect(result).toHaveLength(1);
    expect(result[0]!.message).toBe('test');
  });

  it('parses log output without year prefix (MM-DD format)', () => {
    const raw = [
      ' 03-30 15:39:37 ovpn,info connection established from 152.32.197.159',
      ' 03-30 15:39:37 ovpn,info <152.32.197.159>: disconnected',
    ].join('\r\n');
    const result = parseLog(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      time: '03-30 15:39:37',
      topics: 'ovpn,info',
      message: 'connection established from 152.32.197.159',
    });
  });

  it('handles messages with special characters', () => {
    const raw =
      ' 2026-03-22 16:42:41 system,error,critical login failure for user admin from 84:3A:5B:22:49:D0 via winbox\r\n';
    const result = parseLog(raw);
    expect(result).toHaveLength(1);
    expect(result[0]!.topics).toBe('system,error,critical');
    expect(result[0]!.message).toBe(
      'login failure for user admin from 84:3A:5B:22:49:D0 via winbox',
    );
  });
});

describe('parseFiles', () => {
  it('parses file detail output from real device', () => {
    const raw =
      'Flags: S - SHARED \r\n 0   name=auto-before-reset.backup type=backup size=25.2KiB \r\n     last-modified=1970-01-01 \r\n\r\n 1   name=skins type=directory last-modified=1970-01-01 \r\n\r\n';
    const result = parseFiles(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: 'auto-before-reset.backup',
      type: 'backup',
      size: '25.2KiB',
      lastModified: '1970-01-01',
    });
    expect(result[1]!.name).toBe('skins');
    expect(result[1]!.type).toBe('directory');
  });

  it('returns empty array for empty output', () => {
    expect(parseFiles('')).toEqual([]);
  });
});

describe('registerLogTools', () => {
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

  it('registers all 2 log/files tools', () => {
    registerLogTools(server, mockKeepass, mockTransport);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(tools).toHaveProperty('log-get');
    expect(tools).toHaveProperty('files-list');
  });

  describe('log-get handler', () => {
    it('calls fanOut and returns content', async () => {
      registerLogTools(server, mockKeepass, mockTransport);
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools['log-get']!.handler;
      mockFanOut.mockResolvedValue([]);
      const result = await handler({ target: 'R1' }, {});
      expect(mockFanOut).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('content');
    });
  });

  describe('files-list handler', () => {
    it('calls fanOut with correct target', async () => {
      registerLogTools(server, mockKeepass, mockTransport);
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools['files-list']!.handler;
      mockFanOut.mockResolvedValue([]);
      await handler({ target: 'all' }, {});
      expect(mockFanOut).toHaveBeenCalledOnce();
      const [, target] = mockFanOut.mock.calls[0]!;
      expect(target).toBe('all');
    });
  });
});
