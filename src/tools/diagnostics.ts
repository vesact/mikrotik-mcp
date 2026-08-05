/**
 * Network Diagnostics tools — ping, traceroute, bandwidth-test, torch,
 * packet-sniffer, profile, netwatch, fetch, speed-test, wol, mac-scan, ip-scan, traffic-gen.
 * RouterOS sections: /ping, /tool
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { fanOut } from '../fan-out.js';
import type { KeePassClient, DeviceTransport, ToolDeps } from '../types/index.js';
import { parseDetailRecords, normalizeRecord } from '../parsers.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum duration (seconds) for long-running commands to stay within 60s REST timeout. */
const MAX_REST_DURATION = '50';

/** Clamp a duration string to the REST-safe maximum. */
function clampDuration(dur: string, max = MAX_REST_DURATION): string {
  const n = parseInt(dur, 10);
  const m = parseInt(max, 10);
  if (Number.isNaN(n) || n > m) return max;
  return String(n);
}

// ---------------------------------------------------------------------------
// Parsers (kept for SSH fallback compatibility)
// ---------------------------------------------------------------------------

/** Parse ping output — RouterOS outputs line-by-line then summary */
export function parsePing(raw: string): {
  sent: number;
  received: number;
  packetLoss: string;
  minRtt: string;
  avgRtt: string;
  maxRtt: string;
} {
  const result = { sent: 0, received: 0, packetLoss: '', minRtt: '', avgRtt: '', maxRtt: '' };
  const sentMatch = raw.match(/sent=(\d+)/);
  const recvMatch = raw.match(/received=(\d+)/);
  const lossMatch = raw.match(/packet-loss=(\d+%)/);
  const minMatch = raw.match(/min-rtt=(\S+)/);
  const avgMatch = raw.match(/avg-rtt=(\S+)/);
  const maxMatch = raw.match(/max-rtt=(\S+)/);
  if (sentMatch) result.sent = parseInt(sentMatch[1], 10);
  if (recvMatch) result.received = parseInt(recvMatch[1], 10);
  if (lossMatch) result.packetLoss = lossMatch[1];
  if (minMatch) result.minRtt = minMatch[1];
  if (avgMatch) result.avgRtt = avgMatch[1];
  if (maxMatch) result.maxRtt = maxMatch[1];
  return result;
}

/** Parse traceroute output — RouterOS tabular format with Columns header */
export function parseTraceroute(raw: string): Array<{
  hop: string;
  address: string;
  loss: string;
  sent: string;
  lastRtt: string;
  avgRtt: string;
  bestRtt: string;
  worstRtt: string;
}> {
  const hops: Array<{
    hop: string;
    address: string;
    loss: string;
    sent: string;
    lastRtt: string;
    avgRtt: string;
    bestRtt: string;
    worstRtt: string;
  }> = [];
  for (const line of raw.split('\n')) {
    // Match: hop#  address  loss  sent  last  avg  best  worst  [std-dev]
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/);
    if (m) {
      hops.push({
        hop: m[1],
        address: m[2],
        loss: m[3],
        sent: m[4],
        lastRtt: m[5],
        avgRtt: m[6],
        bestRtt: m[7],
        worstRtt: m[8],
      });
    }
  }
  return hops;
}

/** Parse netwatch entries */
export function parseNetwatch(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerDiagnosticTools(
  server: McpServer,
  keepass: KeePassClient,
  transport: DeviceTransport,
): void {
  // --- tools-ping ---
  server.registerTool(
    'tools-ping',
    {
      description: 'Ping a target from one or all devices',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all'"),
        address: z.string().describe('IP or hostname to ping'),
        count: z.string().optional().describe('Number of pings (default 4)'),
      },
    },
    async ({ target, address, count }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const c = count ?? '4';
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.execute(cred, '/ping', { address, count: c });
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- tools-traceroute ---
  server.registerTool(
    'tools-traceroute',
    {
      description: 'Run traceroute from a device',
      inputSchema: {
        target: z.string().describe('Device ID'),
        address: z.string().describe('IP or hostname to trace'),
      },
    },
    async ({ target, address }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.execute(cred, '/tool/traceroute', {
          address,
          count: '1',
          'use-dns': 'no',
        });
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- tools-bandwidth-test ---
  server.registerTool(
    'tools-bandwidth-test',
    {
      description:
        'Run bandwidth test from a device to a target address (Note: REST transport has 60s timeout; duration capped to 50s)',
      inputSchema: {
        target: z.string().describe('Device ID'),
        address: z.string().describe('Bandwidth test server address'),
        protocol: z.string().optional().describe('Protocol: tcp or udp (default tcp)'),
        duration: z
          .string()
          .optional()
          .describe('Duration in seconds (default 10, max 50 for REST timeout safety)'),
      },
    },
    async ({ target, address, protocol, duration }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const args: Record<string, string> = { address };
      if (protocol) args.protocol = protocol;
      args.duration = clampDuration(duration ?? '10');
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.execute(cred, '/tool/bandwidth-test', args);
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- tools-torch ---
  server.registerTool(
    'tools-torch',
    {
      description:
        'Run torch (traffic snapshot) on an interface (Note: REST transport has 60s timeout; duration capped to 50s)',
      inputSchema: {
        target: z.string().describe('Device ID'),
        interface: z.string().describe('Interface name'),
        duration: z
          .string()
          .optional()
          .describe('Duration in seconds (default 5, max 50 for REST timeout safety)'),
      },
    },
    async ({ target, interface: iface, duration }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const dur = clampDuration(duration ?? '5');
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.execute(cred, '/tool/torch', { interface: iface, duration: dur });
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- tools-packet-sniffer ---
  server.registerTool(
    'tools-packet-sniffer',
    {
      description:
        'Run quick packet sniffer capture on a device (Note: REST transport has 60s timeout; duration capped to 50s)',
      inputSchema: {
        target: z.string().describe('Device ID'),
        interface: z.string().optional().describe('Interface to capture on'),
        duration: z
          .string()
          .optional()
          .describe('Duration in seconds (default 5, max 50 for REST timeout safety)'),
      },
    },
    async ({ target, interface: iface, duration }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const args: Record<string, string> = {};
      if (iface) args.interface = iface;
      args.duration = clampDuration(duration ?? '5');
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.execute(cred, '/tool/sniffer/quick', args);
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- tools-profile ---
  server.registerTool(
    'tools-profile',
    {
      description:
        'Get CPU profile (top processes) on a device (Note: REST transport has 60s timeout; duration capped to 50s)',
      inputSchema: {
        target: z.string().describe('Device ID'),
        duration: z
          .string()
          .optional()
          .describe('Duration in seconds (default 5, max 50 for REST timeout safety)'),
      },
    },
    async ({ target, duration }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const dur = clampDuration(duration ?? '5');
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.execute(cred, '/tool/profile', { duration: dur });
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- tools-netwatch-list ---
  server.registerTool(
    'tools-netwatch-list',
    {
      description: 'List Netwatch entries on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/tool/netwatch');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- tools-fetch ---
  server.registerTool(
    'tools-fetch',
    {
      description:
        'Fetch a URL to a device (Note: REST transport has 60s timeout; large downloads may exceed this limit)',
      inputSchema: {
        target: z.string().describe('Device ID'),
        url: z.string().describe('URL to fetch'),
        dstPath: z.string().optional().describe('Destination file path on device'),
      },
    },
    async ({ target, url, dstPath }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const args: Record<string, string> = { url };
      if (dstPath) args['dst-path'] = dstPath;
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.execute(cred, '/tool/fetch', args);
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- tools-speed-test ---
  server.registerTool(
    'tools-speed-test',
    {
      description: 'Run speed test from a device (Note: REST transport has 60s timeout)',
      inputSchema: { target: z.string().describe('Device ID') },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.execute(cred, '/tool/speed-test', {});
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- tools-wol ---
  server.registerTool(
    'tools-wol',
    {
      description: 'Send Wake-on-LAN packet from a device',
      inputSchema: {
        target: z.string().describe('Device ID'),
        mac: z.string().describe('MAC address to wake'),
        interface: z.string().optional().describe('Interface to send WoL on'),
      },
    },
    async ({ target, mac, interface: iface }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const args: Record<string, string> = { mac };
      if (iface) args.interface = iface;
      const results = await fanOut(deps, target, async (cred, d) => {
        await d.transport.execute(cred, '/tool/wol', args);
        return { success: true };
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- tools-mac-scan ---
  server.registerTool(
    'tools-mac-scan',
    {
      description:
        'Scan for MAC addresses on an interface (Note: REST transport has 60s timeout; duration capped to 50s)',
      inputSchema: {
        target: z.string().describe('Device ID'),
        interface: z.string().describe('Interface to scan'),
        duration: z
          .string()
          .optional()
          .describe('Duration in seconds (default 5, max 50 for REST timeout safety)'),
      },
    },
    async ({ target, interface: iface, duration }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const dur = clampDuration(duration ?? '5');
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.execute(cred, '/tool/mac-scan', { interface: iface, duration: dur });
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- tools-ip-scan ---
  server.registerTool(
    'tools-ip-scan',
    {
      description:
        'Scan for IP addresses in a range (Note: REST transport has 60s timeout; duration capped to 50s)',
      inputSchema: {
        target: z.string().describe('Device ID'),
        addressRange: z.string().describe('IP range to scan (e.g., 10.0.0.0/24)'),
        interface: z.string().optional().describe('Interface to scan from'),
        duration: z
          .string()
          .optional()
          .describe('Duration in seconds (default 5, max 50 for REST timeout safety)'),
      },
    },
    async ({ target, addressRange, interface: iface, duration }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const dur = clampDuration(duration ?? '5');
      const args: Record<string, string> = { 'address-range': addressRange, duration: dur };
      if (iface) args.interface = iface;
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.execute(cred, '/tool/ip-scan', args);
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- tools-traffic-gen ---
  server.registerTool(
    'tools-traffic-gen',
    {
      description: 'Start traffic generator on a device (Note: REST transport has 60s timeout)',
      inputSchema: {
        target: z.string().describe('Device ID'),
        interface: z.string().describe('Interface to generate traffic on'),
        packetSize: z.string().optional().describe('Packet size in bytes'),
        mbps: z.string().optional().describe('Target Mbps'),
      },
    },
    async ({ target, interface: iface, packetSize, mbps }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const args: Record<string, string> = { interface: iface };
      if (packetSize) args['packet-size'] = packetSize;
      if (mbps) args.mbps = mbps;
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.execute(cred, '/tool/traffic-generator/quick', args);
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );
}
