import { describe, it, expect, beforeAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeePassClientImpl } from '../../../src/keepass/keepass-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Test vault credentials (tests/fixtures/test-vault.kdbx):
 * - Password: test-password-123
 * - Group "Mikrotik-CHR" contains 3 entries:
 *   - Router-01: admin / secret1 / 192.168.1.1
 *   - Router-02: admin / secret2 / 192.168.1.2
 *   - Switch-01: operator / secret3 / 10.0.0.1
 * - Group "EmptyGroup" exists but has no entries
 */
const TEST_VAULT_PATH = resolve(__dirname, '../../fixtures/test-vault.kdbx');
const TEST_PASSWORD = 'test-password-123';
const TEST_GROUP = 'Mikrotik-CHR';

describe('KeePassClientImpl', () => {
  describe('listDevices()', () => {
    it('returns all entries from the configured group', async () => {
      const client = new KeePassClientImpl(TEST_VAULT_PATH, TEST_PASSWORD, TEST_GROUP);
      await client.open();

      const devices = await client.listDevices();

      expect(devices).toHaveLength(3);
      expect(devices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            deviceId: 'Router-01',
            username: 'admin',
            password: 'secret1',
            hostname: '192.168.1.1',
          }),
          expect.objectContaining({
            deviceId: 'Router-02',
            username: 'admin',
            password: 'secret2',
            hostname: '192.168.1.2',
          }),
          expect.objectContaining({
            deviceId: 'Switch-01',
            username: 'operator',
            password: 'secret3',
            hostname: '10.0.0.1',
          }),
        ]),
      );
    });
  });

  describe('resolveCredentials()', () => {
    let client: KeePassClientImpl;

    beforeAll(async () => {
      client = new KeePassClientImpl(TEST_VAULT_PATH, TEST_PASSWORD, TEST_GROUP);
      await client.open();
    });

    it('returns the matching credential for an existing device', async () => {
      const cred = await client.resolveCredentials('Router-01');

      expect(cred).toEqual({
        deviceId: 'Router-01',
        username: 'admin',
        password: 'secret1',
        hostname: '192.168.1.1',
        notes: expect.any(String),
      });
    });

    it('throws a clear error when deviceId is not found', async () => {
      await expect(client.resolveCredentials('NonExistent-Device')).rejects.toThrow(
        /device.*not found/i,
      );
    });
  });

  describe('error handling', () => {
    it('throws a clear error when password is missing (empty string)', async () => {
      const client = new KeePassClientImpl(TEST_VAULT_PATH, '', TEST_GROUP);
      await expect(client.open()).rejects.toThrow(/password/i);
    });

    it('throws a clear error when password is wrong', async () => {
      const client = new KeePassClientImpl(TEST_VAULT_PATH, 'wrong-password', TEST_GROUP);
      await expect(client.open()).rejects.toThrow();
    });

    it('throws a clear error when group does not exist', async () => {
      const client = new KeePassClientImpl(TEST_VAULT_PATH, TEST_PASSWORD, 'NonExistentGroup');
      await expect(client.open()).rejects.toThrow(/group.*not found/i);
    });

    it('throws a clear error when vault file does not exist', async () => {
      const client = new KeePassClientImpl(
        '/nonexistent/path/vault.kdbx',
        TEST_PASSWORD,
        TEST_GROUP,
      );
      await expect(client.open()).rejects.toThrow();
    });

    it('error messages never contain password or credential values', async () => {
      const sensitiveValues = [TEST_PASSWORD, 'secret1', 'secret2', 'secret3'];

      // Wrong password error
      const wrongPwClient = new KeePassClientImpl(TEST_VAULT_PATH, 'wrong-pw-value', TEST_GROUP);
      try {
        await wrongPwClient.open();
      } catch (err: unknown) {
        const msg = (err as Error).message;
        expect(msg).not.toContain('wrong-pw-value');
      }

      // Missing group error
      const badGroupClient = new KeePassClientImpl(TEST_VAULT_PATH, TEST_PASSWORD, 'BadGroup');
      try {
        await badGroupClient.open();
      } catch (err: unknown) {
        const msg = (err as Error).message;
        for (const val of sensitiveValues) {
          expect(msg).not.toContain(val);
        }
      }

      // Device not found error
      const client = new KeePassClientImpl(TEST_VAULT_PATH, TEST_PASSWORD, TEST_GROUP);
      await client.open();
      try {
        await client.resolveCredentials('NoSuchDevice');
      } catch (err: unknown) {
        const msg = (err as Error).message;
        for (const val of sensitiveValues) {
          expect(msg).not.toContain(val);
        }
      }
    });
  });
});
