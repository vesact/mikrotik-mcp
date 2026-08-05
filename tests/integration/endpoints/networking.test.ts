/**
 * Integration tests — Networking endpoints (IP, ARP, Routes, Interfaces, Bridge).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { DeviceTransport, KeePassCredential } from '../../../src/types/index.js';
import { loadTestConfig, requireDevices, type TestDevice } from '../config.js';
import { assertHasKeys, createTransport, toCredential } from '../helpers.js';

let device: TestDevice;
let transport: DeviceTransport;
let cred: KeePassCredential;

beforeAll(() => {
  const config = loadTestConfig();
  [device] = requireDevices(config, 1);
  transport = createTransport(device);
  cred = toCredential(device);
});

describe('Interfaces', () => {
  it('GET /interface returns interface list', async () => {
    const records = await transport.query(cred, '/interface');
    expect(records.length).toBeGreaterThanOrEqual(1);
    assertHasKeys(records[0], ['name', 'type']);
  });

  it('GET /interface/ethernet returns ethernet interfaces', async () => {
    const records = await transport.query(cred, '/interface/ethernet');
    expect(records.length).toBeGreaterThanOrEqual(1);
    assertHasKeys(records[0], ['name', 'default-name']);
  });
});

describe('Bridge', () => {
  it('GET /interface/bridge returns bridges', async () => {
    const records = await transport.query(cred, '/interface/bridge');
    // Device may not have bridges configured
    expect(Array.isArray(records)).toBe(true);
  });

  it('GET /interface/bridge/port returns bridge ports', async () => {
    const records = await transport.query(cred, '/interface/bridge/port');
    expect(Array.isArray(records)).toBe(true);
  });
});

describe('IP Addresses', () => {
  it('GET /ip/address returns at least one address', async () => {
    const records = await transport.query(cred, '/ip/address');
    expect(records.length).toBeGreaterThanOrEqual(1);
    assertHasKeys(records[0], ['address', 'interface', 'network']);
  });
});

describe('ARP', () => {
  it('GET /ip/arp returns ARP entries', async () => {
    const records = await transport.query(cred, '/ip/arp');
    expect(Array.isArray(records)).toBe(true);
  });
});

describe('Routes', () => {
  it('GET /ip/route returns routing table', async () => {
    const records = await transport.query(cred, '/ip/route');
    expect(records.length).toBeGreaterThanOrEqual(1);
    assertHasKeys(records[0], ['dst-address']);
  });
});

describe('IP Pools', () => {
  it('GET /ip/pool returns pools (may be empty)', async () => {
    const records = await transport.query(cred, '/ip/pool');
    expect(Array.isArray(records)).toBe(true);
  });
});
