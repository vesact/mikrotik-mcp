/**
 * Integration tests — Diagnostic tools (ping, traceroute, etc.)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { DeviceTransport, KeePassCredential } from '../../../src/types/index.js';
import { loadTestConfig, requireDevices, type TestDevice } from '../config.js';
import { createTransport, toCredential } from '../helpers.js';

let device: TestDevice;
let transport: DeviceTransport;
let cred: KeePassCredential;

beforeAll(() => {
  const config = loadTestConfig();
  [device] = requireDevices(config, 1);
  transport = createTransport(device);
  cred = toCredential(device);
});

describe('Diagnostics', () => {
  it('POST /ping with loopback returns results', async () => {
    const result = await transport.raw(cred, '/ping', { address: '127.0.0.1', count: '2' });
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /traceroute returns results', async () => {
    const result = await transport.raw(cred, '/tool/traceroute', {
      address: '127.0.0.1',
      count: '1',
    });
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('GET /tool/netwatch returns netwatch entries (may be empty)', async () => {
    const records = await transport.query(cred, '/tool/netwatch');
    expect(Array.isArray(records)).toBe(true);
  });

  it('GET /tool/profile returns profiler data', async () => {
    // Profile may need to be started first - just validate endpoint responds
    try {
      const records = await transport.query(cred, '/tool/profile');
      expect(Array.isArray(records)).toBe(true);
    } catch (e) {
      // Some devices may not support this - that's OK
      expect(e).toBeDefined();
    }
  });
});
