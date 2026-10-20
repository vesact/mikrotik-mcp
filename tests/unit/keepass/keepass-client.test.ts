import { chmod, copyFile, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import kdbxweb from 'kdbxweb';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

  describe('createEntry()', () => {
    let workDir: string;
    let vaultPath: string;

    const entry = (deviceId: string) => ({
      deviceId,
      username: 'admin',
      password: `pw-${deviceId}`,
      hostname: '192.0.2.1',
    });

    beforeEach(async () => {
      workDir = await mkdtemp(join(tmpdir(), 'keepass-test-'));
      vaultPath = join(workDir, 'vault.kdbx');
      await copyFile(TEST_VAULT_PATH, vaultPath);
    });

    afterEach(async () => {
      await rm(workDir, { recursive: true, force: true });
    });

    it('persists the entry so a fresh client can resolve it', async () => {
      const writer = new KeePassClientImpl(vaultPath, TEST_PASSWORD, TEST_GROUP);
      await writer.open();
      await writer.createEntry(entry('Router-03'));

      const reader = new KeePassClientImpl(vaultPath, TEST_PASSWORD, TEST_GROUP);
      await reader.open();
      const cred = await reader.resolveCredentials('Router-03');
      expect(cred.password).toBe('pw-Router-03');
      expect(await reader.listDevices()).toHaveLength(4);
    });

    it('keeps both entries when two writers save at the same time', async () => {
      const a = new KeePassClientImpl(vaultPath, TEST_PASSWORD, TEST_GROUP);
      const b = new KeePassClientImpl(vaultPath, TEST_PASSWORD, TEST_GROUP);
      await a.open();
      await b.open();

      await Promise.all([a.createEntry(entry('Router-03')), b.createEntry(entry('Router-04'))]);

      const ids = (await a.listDevices()).map((d) => d.deviceId);
      expect(ids).toEqual(expect.arrayContaining(['Router-03', 'Router-04']));
      expect(ids).toHaveLength(5);
    });

    it('re-applies its entry when another process saved in the meantime', async () => {
      // Build the "other process" version of the vault: fixture + Router-04.
      const otherPath = join(workDir, 'other.kdbx');
      await copyFile(TEST_VAULT_PATH, otherPath);
      const other = new KeePassClientImpl(otherPath, TEST_PASSWORD, TEST_GROUP);
      await other.open();
      await other.createEntry(entry('Router-04'));
      const otherBytes = await readFile(otherPath);

      // That save lands on disk while our first save is still running.
      const realSave = kdbxweb.Kdbx.prototype.save;
      const save = vi.spyOn(kdbxweb.Kdbx.prototype, 'save').mockImplementationOnce(async function (
        this: kdbxweb.Kdbx,
      ) {
        const out = await realSave.call(this);
        await writeFile(vaultPath, otherBytes);
        return out;
      });

      const client = new KeePassClientImpl(vaultPath, TEST_PASSWORD, TEST_GROUP);
      await client.open();
      await client.createEntry(entry('Router-03'));
      save.mockRestore();

      const ids = (await client.listDevices()).map((d) => d.deviceId);
      expect(ids).toEqual(expect.arrayContaining(['Router-03', 'Router-04']));
      expect(ids).toHaveLength(5);
    });

    it('replaces the vault atomically, keeping its mode and leaving no temp file', async () => {
      await chmod(vaultPath, 0o600);
      const client = new KeePassClientImpl(vaultPath, TEST_PASSWORD, TEST_GROUP);
      await client.open();
      await client.createEntry(entry('Router-03'));

      expect((await stat(vaultPath)).mode & 0o777).toBe(0o600);
      expect(await readdir(workDir)).toEqual(['vault.kdbx']);
    });

    it('refuses a duplicate title', async () => {
      const client = new KeePassClientImpl(vaultPath, TEST_PASSWORD, TEST_GROUP);
      await client.open();
      await expect(client.createEntry(entry('Router-01'))).rejects.toThrow('already exists');
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
