/**
 * IP Addressing & Routing tools — addresses, ARP, routes, pools, settings.
 * RouterOS sections: /ip/address, /ip/arp, /ip/route, /ip/pool, /ip/settings
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

/** Parse `/ip/address/print detail` output. */
export function parseAddresses(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

/** Parse `/ip/arp/print detail` output. */
export function parseArp(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

/** Parse `/ip/route/print detail` output. */
export function parseRoutes(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

/** Parse `/ip/pool/print detail` output. */
export function parsePools(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

/** Parse `/ip/settings/print` key-value output. */
export function parseIpSettings(raw: string): Record<string, unknown> {
  return normalizeRecord(parseKeyValue(raw));
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerIpTools(
  server: McpServer,
  keepass: KeePassClient,
  transport: DeviceTransport,
): void {
  // --- ip-address-list ---
  server.registerTool(
    'ip-address-list',
    {
      description: 'List IP addresses on one or all devices',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
      },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/ip/address');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- ip-arp-list ---
  server.registerTool(
    'ip-arp-list',
    {
      description: 'List ARP table entries on one or all devices',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
      },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/ip/arp');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- ip-routes-list ---
  server.registerTool(
    'ip-routes-list',
    {
      description: 'List IP routes on one or all devices',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
      },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/ip/route');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- ip-pool-list ---
  server.registerTool(
    'ip-pool-list',
    {
      description: 'List IP pools on one or all devices',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
      },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/ip/pool');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- ip-settings-get ---
  server.registerTool(
    'ip-settings-get',
    {
      description: 'Get IP settings on one or all devices',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
      },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        const records = await d.transport.query(cred, '/ip/settings');
        return records[0] ?? {};
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );
}
