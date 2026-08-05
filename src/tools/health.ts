/**
 * Health & hardware tools — system health, routerboard, watchdog.
 * RouterOS section: /system/health, /system/routerboard, /system/watchdog
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { fanOut } from '../fan-out.js';
import type { KeePassClient, DeviceTransport, ToolDeps } from '../types/index.js';
import { parseKeyValue, parseDetailRecords, normalizeRecord } from '../parsers.js';

// ---------------------------------------------------------------------------
// Parsers (pure functions — independently unit-testable)
// ---------------------------------------------------------------------------

/**
 * Parse `/system/health/print detail` output into an array of health entries.
 */
export function parseHealth(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

/**
 * Parse `/system/routerboard/print` output (key-value format).
 */
export function parseRouterboard(raw: string): Record<string, unknown> {
  return normalizeRecord(parseKeyValue(raw));
}

/**
 * Parse `/system/watchdog/print` output (key-value format).
 */
export function parseWatchdog(raw: string): Record<string, unknown> {
  return normalizeRecord(parseKeyValue(raw));
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/** Register system health and hardware tools on the MCP server. */
export function registerHealthTools(
  server: McpServer,
  keepass: KeePassClient,
  transport: DeviceTransport,
): void {
  // --- system-health-get ---
  server.registerTool(
    'system-health-get',
    {
      description:
        'Get hardware health metrics (voltage, temperature, fan, PSU) of one or all devices',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
      },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/system/health');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- system-routerboot-get ---
  server.registerTool(
    'system-routerboot-get',
    {
      description: 'Get RouterBOOT version and hardware info of one or all devices',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
      },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        const records = await d.transport.query(cred, '/system/routerboard');
        return records[0] ?? {};
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- system-watchdog-get ---
  server.registerTool(
    'system-watchdog-get',
    {
      description: 'Get watchdog configuration of one or all devices',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
      },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        const records = await d.transport.query(cred, '/system/watchdog');
        return records[0] ?? {};
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );
}
