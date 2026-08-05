/**
 * Quick CLI test: resolve credentials from KeePass vault, connect via SSH,
 * and run /system/identity/print on the first device found.
 *
 * Usage: npx tsx scripts/test-ssh.ts
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeePassClientImpl } from '../src/keepass/keepass-client.js';
import { SshTransportImpl } from '../src/ssh/ssh-transport.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const VAULT_PATH = resolve(__dirname, '../tests/fixtures/test-vault.kdbx');
const VAULT_PASSWORD = 'test-password-123';
const VAULT_GROUP = 'Mikrotik-CHR';

async function main() {
  // 1. Open vault and list devices
  console.log(`Opening vault: ${VAULT_PATH}`);
  const keepass = new KeePassClientImpl(VAULT_PATH, VAULT_PASSWORD, VAULT_GROUP);
  await keepass.open();

  const devices = await keepass.listDevices();
  console.log(`Found ${devices.length} device(s):`);
  for (const d of devices) {
    console.log(`  - ${d.deviceId} @ ${d.hostname}`);
  }

  if (devices.length === 0) {
    console.error('No devices found in vault group.');
    process.exit(1);
  }

  // 2. Pick the first device
  const credential = devices[0]!;
  console.log(`\nConnecting to ${credential.deviceId} (${credential.hostname})...`);

  // 3. Execute command over SSH
  const ssh = new SshTransportImpl({ acceptAllHostKeys: true });
  const command = '/system/identity/print';
  console.log(`Running: ${command}`);

  const output = await ssh.executeCommand(credential, command);
  console.log(`\n--- Output ---\n${output}--- End ---`);
}

main().catch((err: unknown) => {
  console.error('Failed:', (err as Error).message);
  process.exit(1);
});
