/**
 * Interface tools — list, statistics, enable/disable, list membership.
 * RouterOS section: /interface
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

/** Parse `/interface/print detail` output. */
export function parseInterfaces(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

/**
 * Parse `/interface/print stats-detail` output.
 * Note: RouterOS formats numbers with spaces (e.g., "8 875 233").
 * Our regex captures only the first part. We post-process to strip spaces.
 */
export function parseInterfaceStats(raw: string): Array<{
  name: string;
  rxBytes: string;
  txBytes: string;
  rxPackets: string;
  txPackets: string;
  rxDrops: string;
  txDrops: string;
  rxErrors: string;
  txErrors: string;
}> {
  // Custom parsing: split on record boundaries and extract fields
  // handling space-separated numbers
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const results: Array<{
    name: string;
    rxBytes: string;
    txBytes: string;
    rxPackets: string;
    txPackets: string;
    rxDrops: string;
    txDrops: string;
    rxErrors: string;
    txErrors: string;
  }> = [];

  // Strip header lines but preserve blank lines as record separators
  const lines = normalized.split('\n');
  const contentLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('Flags:') || trimmed.startsWith('Columns:')) continue;
    // Skip the `P - PASSTHROUGH` continuation header line
    if (/^[A-Z]\s+-\s+/.test(trimmed)) continue;
    contentLines.push(line);
  }

  // Join content lines preserving blank line boundaries for record splitting
  const joined = contentLines.join('\n');

  // Extract field with space-in-number support
  const extractNumField = (text: string, field: string): string => {
    const regex = new RegExp(`${field}=(\\d[\\d ]*)`);
    const match = regex.exec(text);
    if (!match) return '0';
    return match[1].replace(/ /g, '');
  };

  const extractQuotedField = (text: string, field: string): string => {
    const regex = new RegExp(`${field}="([^"]*)"`);
    const match = regex.exec(text);
    return match ? match[1] : '';
  };

  // Split on blank lines (records are separated by empty lines)
  const blocks = joined.split(/\n\s*\n/);

  for (const block of blocks) {
    const text = block.trim();
    if (!text) continue;
    const name = extractQuotedField(text, 'name');
    if (!name) continue;
    results.push({
      name,
      rxBytes: extractNumField(text, 'rx-byte'),
      txBytes: extractNumField(text, 'tx-byte'),
      rxPackets: extractNumField(text, 'rx-packet'),
      txPackets: extractNumField(text, 'tx-packet'),
      rxDrops: extractNumField(text, 'rx-drop'),
      txDrops: extractNumField(text, 'tx-drop'),
      rxErrors: extractNumField(text, 'rx-error'),
      txErrors: extractNumField(text, 'tx-error'),
    });
  }

  return results;
}

/** Parse `/interface/list/member/print detail` output. */
export function parseInterfaceListMembers(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerInterfaceTools(
  server: McpServer,
  keepass: KeePassClient,
  transport: DeviceTransport,
): void {
  server.registerTool(
    'interface-list',
    {
      description: 'List all interfaces on one or all devices',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
      },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/interface');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.registerTool(
    'interface-stats',
    {
      description: 'Get interface statistics (TX/RX bytes, errors, drops) on one or all devices',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
      },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/interface');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.registerTool(
    'interface-lists',
    {
      description: 'List interface list memberships on one or all devices',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
      },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/interface/list/member');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );
}
