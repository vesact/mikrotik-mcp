/**
 * Integration tests — Firewall, Services, DHCP, DNS.
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

describe('Firewall', () => {
  it('GET /ip/firewall/filter returns filter rules (may be empty)', async () => {
    const records = await transport.query(cred, '/ip/firewall/filter');
    expect(Array.isArray(records)).toBe(true);
  });

  it('GET /ip/firewall/nat returns NAT rules (may be empty)', async () => {
    const records = await transport.query(cred, '/ip/firewall/nat');
    expect(Array.isArray(records)).toBe(true);
  });

  it('GET /ip/firewall/mangle returns mangle rules (may be empty)', async () => {
    const records = await transport.query(cred, '/ip/firewall/mangle');
    expect(Array.isArray(records)).toBe(true);
  });

  it('GET /ip/firewall/address-list returns address lists (may be empty)', async () => {
    const records = await transport.query(cred, '/ip/firewall/address-list');
    expect(Array.isArray(records)).toBe(true);
  });

  it('GET /ip/firewall/connection returns active connections', async () => {
    const records = await transport.query(cred, '/ip/firewall/connection');
    expect(Array.isArray(records)).toBe(true);
  });
});

describe('IP Services', () => {
  it('GET /ip/service returns service list', async () => {
    const records = await transport.query(cred, '/ip/service');
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records[0]).toHaveProperty('name');
  });
});

describe('DHCP', () => {
  it('GET /ip/dhcp-client returns DHCP clients (may be empty)', async () => {
    const records = await transport.query(cred, '/ip/dhcp-client');
    expect(Array.isArray(records)).toBe(true);
  });

  it('GET /ip/dhcp-server returns DHCP servers (may be empty)', async () => {
    const records = await transport.query(cred, '/ip/dhcp-server');
    expect(Array.isArray(records)).toBe(true);
  });

  it('GET /ip/dhcp-server/lease returns leases (may be empty)', async () => {
    const records = await transport.query(cred, '/ip/dhcp-server/lease');
    expect(Array.isArray(records)).toBe(true);
  });
});

describe('DNS', () => {
  it('GET /ip/dns returns DNS config', async () => {
    const records = await transport.query(cred, '/ip/dns');
    expect(records.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /ip/dns/static returns static DNS entries (may be empty)', async () => {
    const records = await transport.query(cred, '/ip/dns/static');
    expect(Array.isArray(records)).toBe(true);
  });
});
