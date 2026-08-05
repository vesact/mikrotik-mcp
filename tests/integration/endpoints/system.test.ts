/**
 * Integration tests — System & Identity endpoints.
 * Validates REST transport against real RouterOS devices.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadTestConfig, requireDevices, type TestDevice } from '../config.js';
import { createTransport, toCredential, assertHasKeys } from '../helpers.js';
import type { DeviceTransport, KeePassCredential } from '../../../src/types/index.js';

let device: TestDevice;
let transport: DeviceTransport;
let cred: KeePassCredential;

beforeAll(() => {
  const config = loadTestConfig();
  [device] = requireDevices(config, 1);
  transport = createTransport(device);
  cred = toCredential(device);
});

describe('System', () => {
  it('GET /system/identity returns name', async () => {
    const records = await transport.query(cred, '/system/identity');
    expect(records).toHaveLength(1);
    expect(records[0]).toHaveProperty('name');
    expect(typeof records[0]!['name']).toBe('string');
  });

  it('GET /system/resource returns device info', async () => {
    const records = await transport.query(cred, '/system/resource');
    expect(records).toHaveLength(1);
    assertHasKeys(records[0]!, [
      'platform',
      'version',
      'cpu',
      'cpu-count',
      'free-memory',
      'total-memory',
      'uptime',
      'architecture-name',
      'board-name',
    ]);
  });

  it('GET /system/clock returns time info', async () => {
    const records = await transport.query(cred, '/system/clock');
    expect(records).toHaveLength(1);
    assertHasKeys(records[0]!, ['time', 'date']);
  });

  it('GET /system/health returns metrics (if supported)', async () => {
    const records = await transport.query(cred, '/system/health');
    // Some devices may not have health sensors
    expect(Array.isArray(records)).toBe(true);
  });

  it('GET /system/routerboard returns board info', async () => {
    const records = await transport.query(cred, '/system/routerboard');
    expect(records.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Packages', () => {
  it('GET /system/package returns installed packages', async () => {
    const records = await transport.query(cred, '/system/package');
    expect(records.length).toBeGreaterThanOrEqual(1);
    assertHasKeys(records[0]!, ['name', 'version']);
  });
});
