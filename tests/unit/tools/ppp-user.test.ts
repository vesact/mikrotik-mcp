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
  parseLogging,
  parsePppAaa,
  parsePppActive,
  parsePppProfiles,
  parsePppSecrets,
  parseScheduler,
  parseScripts,
  parseUsers,
  registerPppUserTools,
} from '../../../src/tools/ppp-user.js';

describe('parsePppProfiles', () => {
  it('returns empty for no profiles', () => {
    expect(parsePppProfiles('')).toEqual([]);
  });
  it('parses profile', () => {
    const raw =
      ' 0 * name="default" use-encryption=default use-compression=default only-one=default \r\n';
    expect(parsePppProfiles(raw)[0]).toEqual({
      name: 'default',
      useEncryption: 'default',
      useCompression: 'default',
      onlyOne: 'default',
    });
  });
});

describe('parsePppSecrets', () => {
  it('returns empty for no secrets', () => {
    expect(parsePppSecrets('')).toEqual([]);
  });
  it('does not expose password', () => {
    const raw = ' 0 name="user1" service=any profile=default password=secret123 \r\n';
    const result = parsePppSecrets(raw);
    expect(result[0]).toEqual({
      name: 'user1',
      service: 'any',
      profile: 'default',
      password: '[REDACTED]',
    });
  });
});

describe('parsePppActive', () => {
  it('returns empty for no sessions', () => {
    expect(parsePppActive('')).toEqual([]);
  });
});

describe('parsePppAaa', () => {
  it('parses AAA config', () => {
    const raw = '                     use-radius: no \r\n                     accounting: yes\r\n';
    expect(parsePppAaa(raw).useRadius).toBe(false);
  });
});

describe('parseUsers', () => {
  it('parses user entry', () => {
    const raw = ' 0 name="admin" group=full last-logged-in=2025-01-15 \r\n';
    expect(parseUsers(raw)[0]).toEqual({
      name: 'admin',
      group: 'full',
      lastLoggedIn: '2025-01-15',
    });
  });
});

describe('parseScheduler', () => {
  it('returns empty for no tasks', () => {
    expect(parseScheduler('')).toEqual([]);
  });
});

describe('parseLogging', () => {
  it('parses logging rules', () => {
    const raw = ' 0 topics=info action=memory prefix="" \r\n';
    expect(parseLogging(raw)[0]).toEqual({ topics: 'info', action: 'memory', prefix: null });
  });
});

describe('parseScripts', () => {
  it('returns empty for no scripts', () => {
    expect(parseScripts('')).toEqual([]);
  });
});

describe('registerPppUserTools', () => {
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

  it('registers all PPP & user tools', () => {
    registerPppUserTools(server, mockKeepass, mockTransport);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    const expected = [
      'ppp-profiles-list',
      'ppp-secrets-list',
      'ppp-active-list',
      'ppp-aaa-get',
      'system-users-list',
      'system-scheduler-list',
      'system-logging-list',
      'system-scripts-list',
    ];
    for (const name of expected) {
      expect(tools).toHaveProperty(name);
    }
  });
});
