/**
 * Device setup tool — bootstraps a freshly cloned MikroTik CHR VM.
 * Sets identity, generates a secure password, optionally relocates the HTTP API
 * to a configured port, and stores credentials in KeePass.
 * Password never leaves the server (it reaches the server log only if both the
 * KeePass write and the rollback of the device password fail).
 */

import { randomBytes } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RestTransportImpl } from '../rest/rest-transport.js';
import type { CredentialProvider, DeviceCredential, DeviceTransport } from '../types/index.js';

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
  const parsed = Number(process.env.ROUTEROS_SETUP_PORT);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : INITIAL_HTTP_PORT;
}

/** Generate a cryptographically secure alphanumeric password. */
export function generatePassword(length: number = PASSWORD_LENGTH): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => PASSWORD_CHARSET[b % PASSWORD_CHARSET.length]).join('');
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

type WritableCredentialProvider = CredentialProvider &
  Required<Pick<CredentialProvider, 'createEntry'>>;

/** Whether the provider can persist credentials, which setup-new-device requires. */
export function supportsWrite(
  provider: CredentialProvider,
): provider is WritableCredentialProvider {
  return typeof provider.createEntry === 'function';
}

// ---------------------------------------------------------------------------
// Core setup logic
// ---------------------------------------------------------------------------

async function setupDevice(
  provider: WritableCredentialProvider,
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
  const noPassCred: DeviceCredential = {
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
      const www = services.find((s) => s.name === 'www');
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
  let adminId: string;
  try {
    const users = await target.query(noPassCred, '/user');
    const admin = users.find((u) => u.name === 'admin');
    if (!admin?.['.id']) {
      return fail('password', new Error('admin user entry not found'), true);
    }
    adminId = admin['.id'];

    await target.execute(noPassCred, '/user/set', { '.id': adminId, password }, { method: 'POST' });
  } catch (err) {
    return fail('password', err, true);
  }

  // --- Step 6: Store credentials in KeePass ---
  const newCred: DeviceCredential = {
    deviceId: identity,
    username: 'admin',
    password,
    hostname: ip,
    notes: notes ?? '',
  };
  try {
    await provider.createEntry({
      deviceId: identity,
      username: 'admin',
      password,
      hostname: ip,
      notes,
    });
  } catch (err) {
    // The password is set on the device but not stored anywhere. Put the
    // device back to an empty admin password so the operator can fix the
    // vault and simply re-run setup.
    try {
      await target.execute(
        newCred,
        '/user/set',
        { '.id': adminId, password: '' },
        { method: 'POST' },
      );
    } catch {
      // Last resort: the server log is the only place left that can hold the
      // password without sending it to the MCP client.
      process.stderr.write(
        `[mikrotik-mcp] setup-new-device: KeePass write and password rollback both failed for ${identity} (${ip}); admin password: ${password}\n`,
      );
      return fail(
        'keepass',
        new Error(
          `${err instanceof Error ? err.message : String(err)}. Rolling back the admin password also failed; the password was written to the server log.`,
        ),
        false,
      );
    }
    return fail(
      'keepass',
      new Error(
        `${err instanceof Error ? err.message : String(err)}. The admin password was reset to empty; fix the vault and re-run setup.`,
      ),
      true,
    );
  }

  // --- Step 7: Verify with new credentials on the target port ---
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

/**
 * Register the setup-new-device tool on the MCP server.
 * Skipped when the provider is read-only: there would be nowhere to store the password.
 */
export function registerSetupTools(
  server: McpServer,
  provider: CredentialProvider,
  _transport: DeviceTransport,
): void {
  if (!supportsWrite(provider)) return;

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
      const result = await setupDevice(provider, ip, identity, notes);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
