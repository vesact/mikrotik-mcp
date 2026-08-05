/**
 * System tools — identity and clock management.
 * RouterOS section: /system/identity, /system/clock
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { fanOut } from '../fan-out.js';
import type { KeePassClient, DeviceTransport, ToolDeps } from '../types/index.js';
import { parseKeyValue, normalizeRecord } from '../parsers.js';

// Re-export for backward compatibility (tests may import from here)
export { parseKeyValue, parseDetailRecords } from '../parsers.js';

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/** Parse `/system/identity/print` output. */
export function parseIdentity(raw: string): Record<string, unknown> {
  return normalizeRecord(parseKeyValue(raw));
}

/** Parse `/system/clock/print` output. */
export function parseClock(raw: string): Record<string, unknown> {
  return normalizeRecord(parseKeyValue(raw));
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/** Register system identity and clock tools on the MCP server. */
export function registerSystemTools(
  server: McpServer,
  keepass: KeePassClient,
  transport: DeviceTransport,
): void {
  // --- system-identity-get ---
  server.registerTool(
    'system-identity-get',
    {
      description: 'Get the system identity (hostname) of one or all devices',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
      },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        const records = await d.transport.query(cred, '/system/identity');
        return records[0] ?? {};
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- system-clock-get ---
  server.registerTool(
    'system-clock-get',
    {
      description: 'Get the system clock (time, date, timezone) of one or all devices',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
      },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        const records = await d.transport.query(cred, '/system/clock');
        return records[0] ?? {};
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );
}
