/**
 * DHCP & DNS tools.
 * RouterOS sections: /ip/dhcp-client, /ip/dhcp-server, /ip/dns
 */

import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fanOut } from '../fan-out.js';
import { normalizeRecord, parseDetailRecords, parseKeyValue } from '../parsers.js';
import type { DeviceTransport, KeePassClient, ToolDeps } from '../types/index.js';

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

export function parseDhcpClient(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

export function parseDhcpServer(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

export function parseDhcpLeases(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

export function parseDhcpNetworks(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

export function parseDns(raw: string): Record<string, unknown> {
  return normalizeRecord(parseKeyValue(raw));
}

export function parseDnsStatic(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerDhcpDnsTools(
  server: McpServer,
  keepass: KeePassClient,
  transport: DeviceTransport,
): void {
  // --- dhcp-client-list ---
  server.registerTool(
    'dhcp-client-list',
    {
      description: 'List DHCP client configurations on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/ip/dhcp-client');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- dhcp-server-list ---
  server.registerTool(
    'dhcp-server-list',
    {
      description: 'List DHCP server instances on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/ip/dhcp-server');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- dhcp-server-leases ---
  server.registerTool(
    'dhcp-server-leases',
    {
      description: 'List DHCP server leases on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/ip/dhcp-server/lease');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- dhcp-server-networks ---
  server.registerTool(
    'dhcp-server-networks',
    {
      description: 'List DHCP server network configurations on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/ip/dhcp-server/network');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- dns-get ---
  server.registerTool(
    'dns-get',
    {
      description: 'Get DNS configuration on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        const records = await d.transport.query(cred, '/ip/dns');
        return records[0] ?? {};
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- dns-static-list ---
  server.registerTool(
    'dns-static-list',
    {
      description: 'List static DNS entries on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/ip/dns/static');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );
}
