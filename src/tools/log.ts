/**
 * Log & files tools.
 * RouterOS section: /log, /file
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { fanOut } from '../fan-out.js';
import type { KeePassClient, DeviceTransport, ToolDeps } from '../types/index.js';
import { parseDetailRecords, normalizeRecord } from '../parsers.js';

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse `/log/print` output (simple format).
 * Each line: ` YYYY-MM-DD HH:MM:SS topics message` or ` MM-DD HH:MM:SS topics message`
 */
export function parseLog(raw: string): Array<{ time: string; topics: string; message: string }> {
  const results: Array<{ time: string; topics: string; message: string }> = [];
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  // Pattern: optional leading space, optional date (YYYY-MM-DD or MM-DD), space, time, space, topics, space, message
  // RouterOS 7 may omit year prefix depending on device/version.
  const regex = /^\s*(?:(\d{4})-)?(\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(\S+)\s+(.*)/;
  for (const line of lines) {
    const match = regex.exec(line);
    if (match) {
      const datePart = match[1] ? `${match[1]}-${match[2]}` : match[2]!;
      results.push({
        time: `${datePart} ${match[3]}`,
        topics: match[4]!,
        message: match[5]!.trim(),
      });
    }
  }
  return results;
}

/**
 * Parse `/file/print detail` output.
 */
export function parseFiles(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerLogTools(
  server: McpServer,
  keepass: KeePassClient,
  transport: DeviceTransport,
): void {
  server.registerTool(
    'log-get',
    {
      description: 'Retrieve log entries from one or all devices with optional topic filter',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
        topics: z.string().optional().describe('Topic filter (e.g. "system" or "interface")'),
      },
    },
    async ({ target, topics }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        const records = await d.transport.query(cred, '/log');
        if (topics) {
          const pattern = topics.toLowerCase();
          return records.filter((r) => {
            const t = (r['topics'] ?? '').toLowerCase();
            return t.includes(pattern);
          });
        }
        return records;
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.registerTool(
    'files-list',
    {
      description: 'List files on one or all devices',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
      },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/file');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );
}
