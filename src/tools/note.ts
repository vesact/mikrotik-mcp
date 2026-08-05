/**
 * System note & LCD tools.
 * RouterOS section: /system/note, /system/lcd
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

/** Parse `/system/note/print` output. */
export function parseNote(raw: string): Record<string, unknown> {
  return normalizeRecord(parseKeyValue(raw));
}

/** Parse `/system/lcd/print` output. Returns empty object if LCD not available. */
export function parseLcd(raw: string): Record<string, unknown> {
  if (raw.includes('syntax error') || raw.includes('bad command') || raw.trim() === '') {
    return {};
  }
  return normalizeRecord(parseKeyValue(raw));
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerNoteTools(
  server: McpServer,
  keepass: KeePassClient,
  transport: DeviceTransport,
): void {
  server.registerTool(
    'system-note-get',
    {
      description: 'Get the system note of one or all devices',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
      },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        const records = await d.transport.query(cred, '/system/note');
        return records[0] ?? {};
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.registerTool(
    'system-lcd-get',
    {
      description:
        'Get LCD panel configuration of one or all devices (empty if hardware not present)',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
      },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        const records = await d.transport.query(cred, '/system/lcd');
        return records[0] ?? {};
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );
}
