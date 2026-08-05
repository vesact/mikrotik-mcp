/**
 * System Administration tools — NTP, SNMP, reboot, shutdown.
 * RouterOS sections: /system/ntp, /snmp, /system
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { fanOut } from '../fan-out.js';
import type { KeePassClient, DeviceTransport, ToolDeps } from '../types/index.js';
import { parseKeyValue, normalizeRecord } from '../parsers.js';

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

export function parseNtp(raw: string): Record<string, unknown> {
  return normalizeRecord(parseKeyValue(raw));
}

export function parseSnmp(raw: string): Record<string, unknown> {
  return normalizeRecord(parseKeyValue(raw));
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerAdminTools(
  server: McpServer,
  keepass: KeePassClient,
  transport: DeviceTransport,
): void {
  server.registerTool(
    'system-ntp-get',
    {
      description: 'Get NTP client configuration on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        const records = await d.transport.query(cred, '/system/ntp/client');
        return records[0] ?? {};
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.registerTool(
    'system-snmp-get',
    {
      description: 'Get SNMP configuration on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        const records = await d.transport.query(cred, '/snmp');
        return records[0] ?? {};
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );
}
