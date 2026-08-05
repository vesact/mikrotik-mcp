/**
 * MCP server setup — REST-first with SSH fallback for raw CLI commands.
 * Instantiates KeePass + transport dependencies, registers tools, returns wired McpServer.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { KeePassClientImpl } from './keepass/keepass-client.js';
import { SshTransportImpl } from './ssh/ssh-transport.js';
import { RestTransportImpl } from './rest/rest-transport.js';
import { fanOut } from './fan-out.js';
import { registerSystemTools } from './tools/system.js';
import { registerHealthTools } from './tools/health.js';
import { registerPackageTools } from './tools/packages.js';
import { registerNoteTools } from './tools/note.js';
import { registerLogTools } from './tools/log.js';
import { registerCertificateTools } from './tools/certificates.js';
import { registerInterfaceTools } from './tools/interfaces.js';
import { registerBridgeTools } from './tools/bridge.js';
import { registerIpTools } from './tools/ip.js';
import { registerFirewallTools } from './tools/firewall.js';
import { registerDhcpDnsTools } from './tools/dhcp-dns.js';
import { registerPppUserTools } from './tools/ppp-user.js';
import { registerAdminTools } from './tools/admin.js';
import { registerDiagnosticTools } from './tools/diagnostics.js';
import { registerSetupTools } from './tools/setup.js';
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
  const keepassPath = process.env['KEEPASS_PATH'] ?? '/config/keepass.kdbx';
  const keepassPassword = process.env['KEEPASS_PASSWORD'] ?? '';
  const keepassGroup = process.env['KEEPASS_GROUP'] ?? 'Mikrotik-CHR';

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
  const readOnly = envFlag(process.env['READ_ONLY']);
  if (readOnly) {
    const originalRegisterTool = server.registerTool.bind(server);
    const skipped: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server as any).registerTool = (name: string, ...rest: unknown[]): unknown => {
      if (!READ_ONLY_TOOLS.has(name)) {
        skipped.push(name);
        // Return a stub matching registerTool's RegisteredTool shape closely
        // enough for callers that ignore the return value (all of ours do).
        return undefined;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalRegisterTool as any)(name, ...rest);
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
  server.registerTool(
    'ros-command',
    {
      description:
        'Execute a raw RouterOS CLI command on one or all devices via SSH. ' +
        'Dry-run is enabled by default: always call with dryRun=true first, then SHOW the user the command and affected devices from the response, ' +
        'and ask for explicit confirmation before calling again with dryRun=false to execute.',
      inputSchema: {
        target: z.string().describe("Device ID, comma-separated IDs, or 'all' for entire fleet"),
        command: z.string().describe('RouterOS CLI command to execute'),
        dryRun: z
          .boolean()
          .default(true)
          .describe('When true (default), shows what would be executed without running it'),
      },
    },
    async ({ target, command, dryRun }) => {
      if (dryRun) {
        // Resolve targets without executing — show what would happen
        const credentials =
          target === 'all'
            ? await keepass.listDevices()
            : await Promise.all(
                target
                  .split(',')
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0)
                  .map((id) => keepass.resolveCredentials(id)),
              );
        const targets = credentials.map((c) => c.deviceId);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ dryRun: true, command, targets }, null, 2),
            },
          ],
        };
      }

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
