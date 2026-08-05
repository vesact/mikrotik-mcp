/**
 * Integration tests — PPP, Users, Logging, SNMP, NTP, Certificates.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadTestConfig, requireDevices, type TestDevice } from '../config.js';
import { createTransport, toCredential } from '../helpers.js';
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

describe('PPP', () => {
  it('GET /ppp/profile returns profiles (may be empty)', async () => {
    const records = await transport.query(cred, '/ppp/profile');
    expect(Array.isArray(records)).toBe(true);
  });

  it('GET /ppp/secret returns secrets (may be empty)', async () => {
    const records = await transport.query(cred, '/ppp/secret');
    expect(Array.isArray(records)).toBe(true);
  });

  it('GET /ppp/active returns active sessions (may be empty)', async () => {
    const records = await transport.query(cred, '/ppp/active');
    expect(Array.isArray(records)).toBe(true);
  });
});

describe('Users', () => {
  it('GET /user returns at least admin user', async () => {
    const records = await transport.query(cred, '/user');
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records[0]).toHaveProperty('name');
  });
});

describe('Scheduler', () => {
  it('GET /system/scheduler returns schedulers (may be empty)', async () => {
    const records = await transport.query(cred, '/system/scheduler');
    expect(Array.isArray(records)).toBe(true);
  });
});

describe('Logging', () => {
  it('GET /system/logging returns logging rules', async () => {
    const records = await transport.query(cred, '/system/logging');
    expect(records.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Scripts', () => {
  it('GET /system/script returns scripts (may be empty)', async () => {
    const records = await transport.query(cred, '/system/script');
    expect(Array.isArray(records)).toBe(true);
  });
});

describe('NTP', () => {
  it('GET /system/ntp/client returns NTP config', async () => {
    const records = await transport.query(cred, '/system/ntp/client');
    expect(records.length).toBeGreaterThanOrEqual(1);
  });
});

describe('SNMP', () => {
  it('GET /snmp returns SNMP config', async () => {
    const records = await transport.query(cred, '/snmp');
    expect(records.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Certificates', () => {
  it('GET /certificate returns certificates (may be empty)', async () => {
    const records = await transport.query(cred, '/certificate');
    expect(Array.isArray(records)).toBe(true);
  });
});

describe('Log', () => {
  it('GET /log returns log entries', async () => {
    const records = await transport.query(cred, '/log');
    expect(records.length).toBeGreaterThanOrEqual(1);
  });
});
