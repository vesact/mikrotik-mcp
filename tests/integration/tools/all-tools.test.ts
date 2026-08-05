/**
 * Integration tests against a real RouterOS 7 device via MCP pipeline.
 *
 * Skip automatically if INTEGRATION_TEST_DEVICE env var is not set.
 * Usage: INTEGRATION_TEST_DEVICE=Router-01 npm run test:integration
 *
 * Requires:
 * - KEEPASS_PATH, KEEPASS_PASSWORD, KEEPASS_GROUP env vars set
 * - Real device reachable via SSH
 */

import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const device = process.env.INTEGRATION_TEST_DEVICE;
const keepassPath = process.env.KEEPASS_PATH;
const keepassPassword = process.env.KEEPASS_PASSWORD;

const shouldRun =
  device != null &&
  device.length > 0 &&
  keepassPath != null &&
  keepassPath.length > 0 &&
  keepassPassword != null &&
  keepassPassword.length > 0;

describe.skipIf(!shouldRun)('Integration: MCP tools against real device', () => {
  let server: McpServer;
  let client: McpClient;

  beforeAll(async () => {
    const { createServer } = await import('../../../src/server.js');
    server = await createServer();
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    client = new McpClient({ name: 'integration-test', version: '1.0.0' });
    await client.connect(clientT);
  });

  afterAll(async () => {
    if (client) await client.close();
    if (server) await server.close();
  });

  /** Helper: call a tool and parse the JSON result */
  async function callTool(name: string, args: Record<string, string> = {}): Promise<unknown[]> {
    const res = await client.callTool({ name, arguments: { target: device, ...args } });
    if (res.isError) {
      const errText = (res.content as Array<{ text?: string }>)[0]?.text ?? 'Unknown tool error';
      throw new Error(`Tool "${name}" returned error: ${errText}`);
    }
    const content = res.content as Array<{ text?: string }>;
    if (!content || content.length === 0 || !content[0]?.text) {
      throw new Error(`Tool "${name}" returned empty or invalid content`);
    }
    const parsed = JSON.parse(content[0].text);
    const results = Array.isArray(parsed) ? parsed : [parsed];
    return results as unknown[];
  }

  // --- Epic 2: System ---
  it('system-identity returns identity', async () => {
    const results = await callTool('system-identity');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  it('system-clock returns clock data', async () => {
    const results = await callTool('system-clock');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  it('system-health returns health data', async () => {
    const results = await callTool('system-health');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  it('system-routerboard returns board info', async () => {
    const results = await callTool('system-routerboard');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  it('system-packages-list returns packages', async () => {
    const results = await callTool('system-packages-list');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  it('system-license returns license', async () => {
    const results = await callTool('system-license');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  it('system-note-get returns note', async () => {
    const results = await callTool('system-note-get');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  it('system-log returns log entries', async () => {
    const results = await callTool('system-log');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  it('system-files-list returns files', async () => {
    const results = await callTool('system-files-list');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  it('system-certificates-list returns certificates', async () => {
    const results = await callTool('system-certificates-list');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  // --- Epic 3: Interfaces ---
  it('interface-list returns interfaces', async () => {
    const results = await callTool('interface-list');
    expect(results).toHaveLength(1);
    const r = results[0] as { success: boolean; data: unknown[] };
    expect(r.success).toBe(true);
    expect(r.data.length).toBeGreaterThan(0);
  });

  it('interface-stats returns stats', async () => {
    const results = await callTool('interface-stats');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  it('bridge-list returns bridges', async () => {
    const results = await callTool('bridge-list');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  it('bridge-hosts returns MAC table', async () => {
    const results = await callTool('bridge-hosts');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  it('ip-neighbors returns neighbors', async () => {
    const results = await callTool('ip-neighbors');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  // --- Epic 4: IP ---
  it('ip-address-list returns addresses', async () => {
    const results = await callTool('ip-address-list');
    expect(results).toHaveLength(1);
    const r = results[0] as { success: boolean; data: unknown[] };
    expect(r.success).toBe(true);
    expect(r.data.length).toBeGreaterThan(0);
  });

  it('ip-arp-list returns ARP entries', async () => {
    const results = await callTool('ip-arp-list');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  it('ip-routes-list returns routes', async () => {
    const results = await callTool('ip-routes-list');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  it('ip-settings-get returns IP settings', async () => {
    const results = await callTool('ip-settings-get');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  // --- Epic 5: Firewall ---
  it('firewall-filter-list returns filter rules', async () => {
    const results = await callTool('firewall-filter-list');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  it('ip-services-list returns services', async () => {
    const results = await callTool('ip-services-list');
    expect(results).toHaveLength(1);
    const r = results[0] as { success: boolean; data: unknown[] };
    expect(r.success).toBe(true);
    expect(r.data.length).toBeGreaterThan(0);
  });

  // --- Epic 6: DHCP & DNS ---
  it('dhcp-client-list returns DHCP clients', async () => {
    const results = await callTool('dhcp-client-list');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  it('dns-get returns DNS config', async () => {
    const results = await callTool('dns-get');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  // --- Epic 7: PPP & Users ---
  it('ppp-profiles-list returns profiles', async () => {
    const results = await callTool('ppp-profiles-list');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  it('system-users-list returns users', async () => {
    const results = await callTool('system-users-list');
    expect(results).toHaveLength(1);
    const r = results[0] as { success: boolean; data: unknown[] };
    expect(r.success).toBe(true);
    expect(r.data.length).toBeGreaterThan(0);
  });

  it('system-logging-list returns logging rules', async () => {
    const results = await callTool('system-logging-list');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  // --- Epic 8: Admin ---
  it('system-ntp-get returns NTP config', async () => {
    const results = await callTool('system-ntp-get');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  it('system-snmp-get returns SNMP config', async () => {
    const results = await callTool('system-snmp-get');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });

  // --- Epic 9: Diagnostics ---
  it('tools-netwatch-list returns netwatch entries', async () => {
    const results = await callTool('tools-netwatch-list');
    expect(results).toHaveLength(1);
    expect((results[0] as { success: boolean }).success).toBe(true);
  });
});
