import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { KeePassClient, DeviceTransport } from '../../../src/types/index.js';

const { mockListDevices, mockResolveCredentials, mockFanOut } = vi.hoisted(() => ({
  mockListDevices: vi.fn(),
  mockResolveCredentials: vi.fn(),
  mockExecuteCommand: vi.fn(),
  mockFanOut: vi.fn(),
}));

vi.mock('../../../src/fan-out.js', () => ({ fanOut: mockFanOut }));

import { parseCertificates, registerCertificateTools } from '../../../src/tools/certificates.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('parseCertificates', () => {
  it('returns empty array for no certificates', () => {
    const raw =
      'Flags: K - PRIVATE-KEY; L - CRL; C - SMART-CARD-KEY; A - AUTHORITY;\r\nI - ISSUED, R - REVOKED; E - EXPIRED; T - TRUSTED\r\n\r\n';
    expect(parseCertificates(raw)).toEqual([]);
  });

  it('returns empty array for empty output', () => {
    expect(parseCertificates('\r\n')).toEqual([]);
  });

  it('parses certificate detail output', () => {
    const raw =
      'Flags: K - PRIVATE-KEY\r\n 0 KT name="my-cert" common-name="example.com" fingerprint="abc123" invalid-before=2025-01-01 invalid-after=2026-01-01 key-size=2048 \r\n\r\n';
    const result = parseCertificates(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'my-cert',
      commonName: 'example.com',
      fingerprint: 'abc123',
      invalidBefore: '2025-01-01',
      invalidAfter: '2026-01-01',
      keySize: 2048,
      privateKey: true,
    });
  });
});

describe('registerCertificateTools', () => {
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

  it('registers certificates tool', () => {
    registerCertificateTools(server, mockKeepass, mockTransport);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(tools).toHaveProperty('system-certificates-list');
  });

  describe('system-certificates-list handler', () => {
    it('calls fanOut and returns content', async () => {
      registerCertificateTools(server, mockKeepass, mockTransport);
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
        }
      )._registeredTools;
      const handler = tools['system-certificates-list']!.handler;
      mockFanOut.mockResolvedValue([]);
      const result = await handler({ target: 'R1' }, {});
      expect(mockFanOut).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('content');
    });
  });
});
