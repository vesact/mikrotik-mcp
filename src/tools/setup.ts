/**
 * Device setup tool — bootstraps a freshly cloned MikroTik CHR VM.
 * Sets identity, generates a secure password, optionally relocates the HTTP API
 * to a configured port, and stores credentials in KeePass.
 * Password never leaves the server.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { RestTransportImpl } from '../rest/rest-transport.js';
import type { KeePassClient, DeviceTransport, KeePassCredential } from '../types/index.js';

// ---------------------------------------------------------------------------
// Password generation
// ---------------------------------------------------------------------------

const PASSWORD_LENGTH = 40;
const PASSWORD_CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Port a freshly cloned CHR serves the unauthenticated `www` service on. */
const INITIAL_HTTP_PORT = 80;

/**
 * Target port for the `www` service, from `ROUTEROS_SETUP_PORT`.
 * Defaults to {@link INITIAL_HTTP_PORT}, which leaves the port unchanged.
 * Set it to relocate the HTTP API as part of bootstrap.
 */
function resolveTargetPort(): number {
  const parsed = Number(process.env['ROUTEROS_SETUP_PORT']);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : INITIAL_HTTP_PORT;
}

/** Generate a cryptographically secure alphanumeric password. */
export function generatePassword(length: number = PASSWORD_LENGTH): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => PASSWORD_CHARSET[b % PASSWORD_CHARSET.length]!).join('');
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

type SetupSuccess = { success: true; identity: string; ip: string };
type SetupFailure = {
  success: false;
  stage: string;
  identity: string;
  ip: string;
  error: string;
  recoverable: boolean;
};
type SetupResult = SetupSuccess | SetupFailure;

// ---------------------------------------------------------------------------
// Core setup logic
// ---------------------------------------------------------------------------

async function setupDevice(
  keepass: KeePassClient,
  ip: string,
  identity: string,
  notes?: string,
): Promise<SetupResult> {
  // Generate password up front so the sanitizer closure can reference it
  const password = generatePassword();

  /** Build a failure result, stripping the generated password from any error text. */
  const fail = (stage: string, err: unknown, recoverable: boolean): SetupFailure => {
    let message = err instanceof Error ? err.message : String(err);
    message = message.replaceAll(password, '[REDACTED]');
    return { success: false, stage, identity, ip, error: message, recoverable };
  };

  // Transports for the two port stages (fresh CHR uses plain HTTP)
  const targetPort = resolveTargetPort();
  const relocatePort = targetPort !== INITIAL_HTTP_PORT;
  const initial = new RestTransportImpl({ port: INITIAL_HTTP_PORT, scheme: 'http' });
  const target = relocatePort
    ? new RestTransportImpl({ port: targetPort, scheme: 'http' })
    : initial;

  // Synthetic credential — fresh CHR has admin with no password
  const noPassCred: KeePassCredential = {
    deviceId: identity,
    username: 'admin',
    password: '',
    hostname: ip,
    notes: '',
  };

  // --- Step 1: Verify connectivity on the initial port ---
  try {
    await initial.query(noPassCred, '/system/identity');
  } catch (err) {
    return fail('connect', err, true);
  }

  // --- Step 2: (password already generated above) ---

  // --- Step 3: Set system identity ---
  try {
    await initial.execute(
      noPassCred,
      '/system/identity/set',
      { name: identity },
      { method: 'POST' },
    );
  } catch (err) {
    return fail('identity', err, true);
  }

  // --- Step 4: Relocate the www service port, when configured ---
  if (relocatePort) {
    try {
      const services = await initial.query(noPassCred, '/ip/service');
      const www = services.find((s) => s['name'] === 'www');
      if (!www?.['.id']) {
        return fail('port-change', new Error('www service entry not found'), true);
      }

      try {
        await initial.execute(
          noPassCred,
          '/ip/service/set',
          { '.id': www['.id'], port: String(targetPort) },
          { method: 'POST' },
        );
      } catch {
        // The port change may drop the HTTP connection before the response
        // arrives. Verify success by connecting on the new port.
        try {
          await target.query(noPassCred, '/system/identity');
        } catch (verifyErr) {
          return fail('port-change', verifyErr, true);
        }
      }
    } catch (err) {
      return fail('port-change', err, true);
    }
  }

  // --- Step 5: Set admin password (target port, still no password) ---
  try {
    const users = await target.query(noPassCred, '/user');
    const admin = users.find((u) => u['name'] === 'admin');
    if (!admin?.['.id']) {
      return fail('password', new Error('admin user entry not found'), true);
    }

    await target.execute(
      noPassCred,
      '/user/set',
      { '.id': admin['.id'], password },
      { method: 'POST' },
    );
  } catch (err) {
    return fail('password', err, true);
  }

  // --- Step 6: Store credentials in KeePass ---
  try {
    await keepass.createEntry({
      deviceId: identity,
      username: 'admin',
      password,
      hostname: ip,
      notes,
    });
  } catch (err) {
    // Non-trivially-recoverable: password IS set on the device but NOT in
    // KeePass. Operator must record the credentials manually.
    return fail('keepass', err, false);
  }

  // --- Step 7: Verify with new credentials on the target port ---
  const newCred: KeePassCredential = {
    deviceId: identity,
    username: 'admin',
    password,
    hostname: ip,
    notes: notes ?? '',
  };
  try {
    await target.query(newCred, '/system/identity');
  } catch (err) {
    return fail('verify', err, false);
  }

  return { success: true, identity, ip };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/** Register the setup-new-device tool on the MCP server. */
export function registerSetupTools(
  server: McpServer,
  keepass: KeePassClient,
  _transport: DeviceTransport,
): void {
  server.registerTool(
    'setup-new-device',
    {
      description:
        'Bootstrap a freshly cloned MikroTik CHR VM: set identity, generate a secure ' +
        'password, and store credentials in KeePass. When ROUTEROS_SETUP_PORT is set, the ' +
        'HTTP API is also relocated from port 80 to that port. The password is generated ' +
        'server-side and NEVER returned to the LLM.\n\n' +
        'The tool reaches the CHR over plain HTTP on port 80 with the default passwordless ' +
        'admin account, so the VM must already be reachable at the given IP. A freshly cloned ' +
        'CHR does not come up with the intended address \u2014 assign it at the network layer ' +
        '(upstream DHCP reservation or static configuration) before calling this tool.',
      inputSchema: {
        ip: z.string().describe('IP address of the fresh CHR (e.g. "192.0.2.95")'),
        identity: z.string().describe('Device name to set as the system identity'),
        notes: z
          .string()
          .optional()
          .describe('Optional free-text notes to store on the KeePass entry'),
      },
    },
    async ({ ip, identity, notes }) => {
      const result = await setupDevice(keepass, ip, identity, notes);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
