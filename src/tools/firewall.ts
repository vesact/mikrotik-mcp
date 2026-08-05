/**
 * Firewall & Security tools — filter, NAT, mangle, address-list, connections, services, RADIUS.
 * RouterOS sections: /ip/firewall/*, /ip/service, /radius
 */

import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fanOut } from '../fan-out.js';
import { normalizeRecord, parseDetailRecords, parseTabularRecords } from '../parsers.js';
import type { DeviceTransport, KeePassClient, ToolDeps } from '../types/index.js';

// ---------------------------------------------------------------------------
// Parsers — universal normalizeRecord passes ALL fields through
// ---------------------------------------------------------------------------

/** Parse `/ip/firewall/filter/print detail` */
export function parseFirewallFilter(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

/** Parse `/ip/firewall/nat/print detail` */
export function parseFirewallNat(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

/** Parse `/ip/firewall/mangle/print detail` */
export function parseFirewallMangle(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

/** Parse `/ip/firewall/address-list/print detail` */
export function parseAddressList(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

/** Parse `/ip/firewall/connection/print detail` */
export function parseConnections(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

/** Parse `/ip/service/print detail` with tabular fallback */
export function parseServices(raw: string): Record<string, unknown>[] {
  const detail = parseDetailRecords(raw).map(normalizeRecord);
  if (detail.length > 0) return detail;
  // Fallback: some devices return tabular format even with `print detail`
  return parseTabularRecords(raw).map(normalizeRecord);
}

/** Parse `/radius/print detail` — secret redacted via REDACTED_FIELDS */
export function parseRadius(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerFirewallTools(
  server: McpServer,
  keepass: KeePassClient,
  transport: DeviceTransport,
): void {
  // --- firewall-filter-list ---
  server.registerTool(
    'firewall-filter-list',
    {
      description: 'List firewall filter rules on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/ip/firewall/filter');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- firewall-nat-list ---
  server.registerTool(
    'firewall-nat-list',
    {
      description: 'List NAT rules on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/ip/firewall/nat');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- firewall-mangle-list ---
  server.registerTool(
    'firewall-mangle-list',
    {
      description: 'List mangle rules on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/ip/firewall/mangle');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- firewall-address-list ---
  server.registerTool(
    'firewall-address-list',
    {
      description: 'List firewall address list entries on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/ip/firewall/address-list');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- firewall-connections-list ---
  server.registerTool(
    'firewall-connections-list',
    {
      description: 'List active firewall connections on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/ip/firewall/connection');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- ip-services-list ---
  server.registerTool(
    'ip-services-list',
    {
      description: 'List IP services on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/ip/service');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- radius-list ---
  server.registerTool(
    'radius-list',
    {
      description: 'List RADIUS server entries on one or all devices (secrets redacted)',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/radius');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );
}
