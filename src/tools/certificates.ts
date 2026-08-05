/**
 * Certificate tools.
 * RouterOS section: /certificate
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
 * Parse `/certificate/print detail` output.
 * Returns empty array if no certificates installed.
 */
export function parseCertificates(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerCertificateTools(
  server: McpServer,
  keepass: KeePassClient,
  transport: DeviceTransport,
): void {
  server.registerTool(
    'system-certificates-list',
    {
      description: 'List certificates on one or all devices',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
      },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/certificate');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );
}
