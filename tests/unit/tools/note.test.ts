import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { KeePassClient, DeviceTransport } from '../../../src/types/index.js';

const { mockListDevices, mockResolveCredentials, mockFanOut } = vi.hoisted(() => ({
  mockListDevices: vi.fn(),
  mockResolveCredentials: vi.fn(),
  mockExecuteCommand: vi.fn(),
  mockFanOut: vi.fn(),
}));

vi.mock('../../../src/fan-out.js', () => ({ fanOut: mockFanOut }));

import { parseNote, parseLcd, registerNoteTools } from '../../../src/tools/note.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('parseNote', () => {
  it('parses note output with full detail fields', () => {
    const raw =
      '      show-at-login: yes\r\n  show-at-cli-login: no \r\n               note:    \r\n\r\n';
    const result = parseNote(raw);
    expect(result).toEqual({
      showAtLogin: true,
      showAtCliLogin: false,
    });
  });

  it('parses note with content', () => {
    const raw = '  show-at-login: yes\r\n  note: Hello World\r\n';
    expect(parseNote(raw)).toEqual({
      note: 'Hello World',
      showAtLogin: true,
    });
  });

  it('returns empty fields for empty output', () => {
    expect(parseNote('')).toEqual({});
  });
});

describe('parseLcd', () => {
  it('returns empty object for syntax error (no LCD hardware)', () => {
    const raw = 'syntax error (line 1 column 12)\n';
    expect(parseLcd(raw)).toEqual({});
  });

  it('returns empty object for empty output', () => {
    expect(parseLcd('')).toEqual({});
  });

  it('parses LCD config if available', () => {
    const raw = '  enabled: yes\r\n  backlight-timeout: 30s\r\n';
    expect(parseLcd(raw)).toEqual({
      enabled: true,
      backlightTimeout: '30s',
    });
  });
});

describe('registerNoteTools', () => {
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

  it('registers all 2 note/lcd tools', () => {
    registerNoteTools(server, mockKeepass, mockTransport);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(tools).toHaveProperty('system-note-get');
    expect(tools).toHaveProperty('system-lcd-get');
  });

  describe('system-note-get handler', () => {
    it('calls fanOut and returns content', async () => {
      registerNoteTools(server, mockKeepass, mockTransport);
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools['system-note-get']!.handler;
      mockFanOut.mockResolvedValue([]);
      const result = await handler({ target: 'R1' }, {});
      expect(mockFanOut).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('content');
    });
  });

  describe('system-lcd-get handler', () => {
    it('calls fanOut with correct target', async () => {
      registerNoteTools(server, mockKeepass, mockTransport);
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools['system-lcd-get']!.handler;
      mockFanOut.mockResolvedValue([]);
      await handler({ target: 'all' }, {});
      expect(mockFanOut).toHaveBeenCalledOnce();
      const [, target] = mockFanOut.mock.calls[0]!;
      expect(target).toBe('all');
    });
  });
});
