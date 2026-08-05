/**
 * Manual smoke test for the REST transport against a real device.
 *
 * Usage:
 *   TEST_HOST=<device-ip> TEST_USER=admin TEST_PASSWORD=<password> \
 *     npx tsx scripts/test-rest-transport.ts
 */
import { RestTransportImpl } from '../src/rest/rest-transport.js';
import type { KeePassCredential } from '../src/types/index.js';

const { TEST_HOST, TEST_USER, TEST_PASSWORD } = process.env;

if (!TEST_HOST || !TEST_USER || !TEST_PASSWORD) {
  console.error('Set TEST_HOST, TEST_USER and TEST_PASSWORD environment variables.');
  process.exit(1);
}

const cred: KeePassCredential = {
  deviceId: 'test-router',
  username: TEST_USER,
  password: TEST_PASSWORD,
  hostname: TEST_HOST,
};

const transport = new RestTransportImpl({
  port: parseInt(process.env['TEST_REST_PORT'] ?? '443', 10),
  scheme: (process.env['TEST_REST_SCHEME'] ?? 'https') as 'http' | 'https',
  timeoutMs: 10000,
});

async function main() {
  console.log('--- query /system/identity ---');
  const identity = await transport.query(cred, '/system/identity');
  console.log(JSON.stringify(identity, null, 2));

  console.log('\n--- query /ip/address ---');
  const addresses = await transport.query(cred, '/ip/address');
  console.log(JSON.stringify(addresses, null, 2));

  console.log('\n--- raw /ping ---');
  const ping = await transport.raw(cred, '/ping', { address: '8.8.8.8', count: '2' });
  console.log(ping);

  console.log('\n--- query /system/resource ---');
  const resource = await transport.query(cred, '/system/resource');
  console.log(JSON.stringify(resource, null, 2));
}

main().catch(console.error);
