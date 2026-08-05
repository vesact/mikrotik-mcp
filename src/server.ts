/**
 * MCP server setup — REST-first with SSH fallback for raw CLI commands.
 * Instantiates KeePass + transport dependencies, registers tools, returns wired McpServer.
 */

import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fanOut } from './fan-out.js';
import { KeePassClientImpl } from './keepass/keepass-client.js';
import { RestTransportImpl } from './rest/rest-transport.js';
import { SshTransportImpl } from './ssh/ssh-transport.js';
import { registerAdminTools } from './tools/admin.js';
import { registerBridgeTools } from './tools/bridge.js';
import { registerCertificateTools } from './tools/certificates.js';
import { registerDhcpDnsTools } from './tools/dhcp-dns.js';
import { registerDiagnosticTools } from './tools/diagnostics.js';
import { registerFirewallTools } from './tools/firewall.js';
import { registerHealthTools } from './tools/health.js';
import { registerInterfaceTools } from './tools/interfaces.js';
import { registerIpTools } from './tools/ip.js';
import { registerLogTools } from './tools/log.js';
import { registerNoteTools } from './tools/note.js';
import { registerPackageTools } from './tools/packages.js';
import { registerPppUserTools } from './tools/ppp-user.js';
import { registerSetupTools } from './tools/setup.js';
import { registerSystemTools } from './tools/system.js';
import type { DeviceTransport, ToolDeps } from './types/index.js';

/**
 * Tools exposed when READ_ONLY mode is enabled.
 *
 * These are strictly state-querying tools — no write/execution (ros-command,
 * setup-new-device) and no active diagnostics (ping, traceroute, torch, etc.),
 * which mutate device state or trigger network activity.
 *
 * This is an ALLOW-LIST: any tool not listed here (including tools added in the
 * future) is withheld in read-only mode. Keep this in sync when adding new
 * read-only tools.
 */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'device-list',
  // bridge
  'bridge-hosts',
  'bridge-list',
  'bridge-ports',
  'bridge-vlans',
  // dhcp / dns
  'dhcp-client-list',
  'dhcp-server-leases',
  'dhcp-server-list',
  'dhcp-server-networks',
  'dns-get',
  'dns-static-list',
  // firewall
  'firewall-address-list',
  'firewall-connections-list',
  'firewall-filter-list',
  'firewall-mangle-list',
  'firewall-nat-list',
  // interfaces
  'interface-list',
  'interface-lists',
  'interface-stats',
  // ip
  'ip-address-list',
  'ip-arp-list',
  'ip-neighbors',
  'ip-pool-list',
  'ip-routes-list',
  'ip-services-list',
  'ip-settings-get',
  // ppp
  'ppp-aaa-get',
  'ppp-active-list',
  'ppp-profiles-list',
  'ppp-secrets-list',
  // misc read
  'radius-list',
  'files-list',
  'log-get',
  'tools-netwatch-list',
  // system
  'system-certificates-list',
  'system-clock-get',
  'system-health-get',
  'system-history-get',
  'system-identity-get',
  'system-license-get',
  'system-logging-list',
  'system-note-get',
  'system-ntp-get',
  'system-packages-list',
  'system-routerboot-get',
  'system-scheduler-list',
  'system-scripts-list',
  'system-snmp-get',
  'system-users-list',
  'system-watchdog-get',
  'system-lcd-get',
]);

/**
 * Parse a boolean-ish env var. Truthy values: "true", "1", "yes", "on"
 * (case-insensitive). Everything else (including unset) is false.
 */
function envFlag(value: string | undefined): boolean {
  if (!value) return false;
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Create and return a fully-wired MCP server.
 *
 * 1. Instantiates KeePass client from env vars and opens vault (fail-fast).
 * 2. Instantiates REST transport (primary) and SSH transport (ros-command fallback).
 * 3. Registers all MCP tools.
 *
 * Caller is responsible for connecting a transport (stdio / HTTP).
 */
export async function createServer(): Promise<McpServer> {
  // --- Dependencies ---
  const keepassPath = process.env.KEEPASS_PATH ?? '/config/keepass.kdbx';
  const keepassPassword = process.env.KEEPASS_PASSWORD ?? '';
  const keepassGroup = process.env.KEEPASS_GROUP ?? 'mikrotik';

  const keepass = new KeePassClientImpl(keepassPath, keepassPassword, keepassGroup);
  await keepass.open(); // fail-fast: throws on bad password / missing vault

  // REST is the primary transport for all structured commands
  const transport: DeviceTransport = new RestTransportImpl();

  // SSH is kept solely for ros-command (arbitrary CLI execution not supported by REST API)
  const sshTransport: DeviceTransport = new SshTransportImpl({ acceptAllHostKeys: true });

  // --- MCP Server ---
  const server = new McpServer({ name: 'mikrotik-mcp', version: '1.0.0' });

  // --- READ_ONLY mode ---
  // When enabled, wrap registerTool so only allow-listed read-only tools are
  // registered. All registration paths below (inline + registerXxxTools) flow
  // through this single choke point, so nothing else needs to change.
  const readOnly = envFlag(process.env.READ_ONLY);
  if (readOnly) {
    // registerTool is heavily overloaded; erase it to a single loose signature
    // so the wrapper can forward arbitrary argument shapes through unchanged.
    type LooseRegisterTool = (name: string, ...rest: unknown[]) => unknown;
    const originalRegisterTool = server.registerTool.bind(server) as unknown as LooseRegisterTool;
    const skipped: string[] = [];
    (server as unknown as { registerTool: LooseRegisterTool }).registerTool = (
      name,
      ...rest
    ): unknown => {
      if (!READ_ONLY_TOOLS.has(name)) {
        skipped.push(name);
        // Return a stub matching registerTool's RegisteredTool shape closely
        // enough for callers that ignore the return value (all of ours do).
        return undefined;
      }
      return originalRegisterTool(name, ...rest);
    };
    process.stderr.write(
      `[mikrotik-mcp] READ_ONLY mode ENABLED — exposing ${READ_ONLY_TOOLS.size} read-only tools; ` +
        `write/execution and active diagnostic tools are withheld.\n`,
    );
    // Note the skipped tools once all registrations have run (deferred log).
    process.nextTick(() => {
      if (skipped.length > 0) {
        process.stderr.write(
          `[mikrotik-mcp] READ_ONLY withheld ${skipped.length} tools: ${skipped.sort().join(', ')}\n`,
        );
      }
    });
  }

  // --- Tool: device-list ---
  server.registerTool(
    'device-list',
    {
      description:
        'List all managed device IDs from the KeePass vault. Use this first to discover available targets before calling other tools.',
      inputSchema: {},
    },
    async () => {
      const devices = await keepass.listDevices();
      const ids = devices.map((d) => ({
        deviceId: d.deviceId,
        hostname: d.hostname,
        username: d.username,
        notes: d.notes || undefined,
        // password is NEVER exposed (NFR-SEC)
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(ids, null, 2) }] };
    },
  );

  // --- Tool: ros-command (uses SSH for arbitrary CLI execution) ---
  //
  // This tool has no built-in confirmation step. Approving individual write calls
  // belongs to the MCP client (per-tool approval / allow-lists), which can enforce
  // it and scope it per agent; a server-side prompt would only be advisory. The
  // server-side control is READ_ONLY=true, which withholds this tool entirely.
  server.registerTool(
    'ros-command',
    {
      description:
        'Execute a raw RouterOS CLI command on one or all devices via SSH. ' +
        'WRITE/EXECUTE tool: the command runs verbatim on every device matched by `target` and may change configuration, ' +
        'interrupt connectivity, or reboot hardware. There is no validation, preview, or rollback.',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
        command: z.string().describe('RouterOS CLI command to execute'),
      },
      annotations: {
        title: 'Run RouterOS command',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ target, command }) => {
      const deps: ToolDeps = { keepass, transport: sshTransport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => d.transport.raw(cred, command));
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // --- Section tools (all use REST transport) ---
  registerSystemTools(server, keepass, transport);
  registerHealthTools(server, keepass, transport);
  registerPackageTools(server, keepass, transport);
  registerNoteTools(server, keepass, transport);
  registerLogTools(server, keepass, transport);
  registerCertificateTools(server, keepass, transport);
  registerInterfaceTools(server, keepass, transport);
  registerBridgeTools(server, keepass, transport);
  registerIpTools(server, keepass, transport);
  registerFirewallTools(server, keepass, transport);
  registerDhcpDnsTools(server, keepass, transport);
  registerPppUserTools(server, keepass, transport);
  registerAdminTools(server, keepass, transport);
  registerDiagnosticTools(server, keepass, transport);
  registerSetupTools(server, keepass, transport);

  return server;
}
