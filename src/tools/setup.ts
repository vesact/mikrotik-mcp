/**
 * Device setup tool — bootstraps a freshly cloned MikroTik CHR VM.
 * Sets identity, generates a secure password, moves HTTP API to port 82,
 * and stores credentials in KeePass. Password never leaves the server.
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
  const port80 = new RestTransportImpl({ port: 80, scheme: 'http' });
  const port82 = new RestTransportImpl({ port: 82, scheme: 'http' });

  // Synthetic credential — fresh CHR has admin with no password
  const noPassCred: KeePassCredential = {
    deviceId: identity,
    username: 'admin',
    password: '',
    hostname: ip,
    notes: '',
  };

  // --- Step 1: Verify connectivity on port 80 ---
  try {
    await port80.query(noPassCred, '/system/identity');
  } catch (err) {
    return fail('connect', err, true);
  }

  // --- Step 2: (password already generated above) ---

  // --- Step 3: Set system identity ---
  try {
    await port80.execute(
      noPassCred,
      '/system/identity/set',
      { name: identity },
      { method: 'POST' },
    );
  } catch (err) {
    return fail('identity', err, true);
  }

  // --- Step 4: Change www service port from 80 → 82 ---
  try {
    const services = await port80.query(noPassCred, '/ip/service');
    const www = services.find((s) => s['name'] === 'www');
    if (!www?.['.id']) {
      return fail('port-change', new Error('www service entry not found'), true);
    }

    try {
      await port80.execute(
        noPassCred,
        '/ip/service/set',
        { '.id': www['.id'], port: '82' },
        { method: 'POST' },
      );
    } catch {
      // The port change may drop the HTTP connection before the response
      // arrives. Verify success by connecting on the new port.
      try {
        await port82.query(noPassCred, '/system/identity');
      } catch (verifyErr) {
        return fail('port-change', verifyErr, true);
      }
    }
  } catch (err) {
    return fail('port-change', err, true);
  }

  // --- Step 5: Set admin password (port 82, still no password) ---
  try {
    const users = await port82.query(noPassCred, '/user');
    const admin = users.find((u) => u['name'] === 'admin');
    if (!admin?.['.id']) {
      return fail('password', new Error('admin user entry not found'), true);
    }

    await port82.execute(
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

  // --- Step 7: Verify with new credentials on port 82 ---
  const newCred: KeePassCredential = {
    deviceId: identity,
    username: 'admin',
    password,
    hostname: ip,
    notes: notes ?? '',
  };
  try {
    await port82.query(newCred, '/system/identity');
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
        'password, move the HTTP API from port 80 to port 82, and store credentials in ' +
        'KeePass. The password is generated server-side and NEVER returned to the LLM.\n\n' +
        'Before calling this tool, you may need to connect to the physical MikroTik router ' +
        'upstream (the one providing DHCP/routing for the 172.16.250.x subnet) to assign the ' +
        'correct static IP to the new CHR first. The naming convention is ' +
        '172.16.250.X \u2192 MikroTikX (e.g. 172.16.250.222 \u2192 MikroTik222). ' +
        'The new CHR will not have the right IP by default after cloning \u2014 it needs to be ' +
        'configured on the network layer before this tool can reach it.',
      inputSchema: {
        ip: z.string().describe('IP address of the fresh CHR (e.g. "172.16.250.95")'),
        identity: z
          .string()
          .describe(
            'Device name following convention 172.16.250.X \u2192 MikroTikX (e.g. "MikroTik95")',
          ),
        notes: z
          .string()
          .optional()
          .describe(
            'KeePass entry notes, typically "BU[number] - [project name]" (e.g. "BU177 - ISB")',
          ),
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
