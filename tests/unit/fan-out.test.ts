import { vi, describe, it, expect, beforeEach } from 'vitest';
import { fanOut } from '../../src/fan-out.js';
import type {
  ToolDeps,
  KeePassClient,
  DeviceTransport,
  KeePassCredential,
} from '../../src/types/index.js';

// --- Test data ---

const router01: KeePassCredential = {
  deviceId: 'Router-01',
  username: 'admin',
  password: 'secret1',
  hostname: '192.168.1.1',
};

const router02: KeePassCredential = {
  deviceId: 'Router-02',
  username: 'admin',
  password: 'secret2',
  hostname: '192.168.1.2',
};

const switch01: KeePassCredential = {
  deviceId: 'Switch-01',
  username: 'operator',
  password: 'secret3',
  hostname: '10.0.0.1',
};

const allDevices = [router01, router02, switch01];

// --- Mock factory ---

function createMockDeps(): ToolDeps & {
  keepass: { [K in keyof KeePassClient]: ReturnType<typeof vi.fn> };
  transport: { [K in keyof DeviceTransport]: ReturnType<typeof vi.fn> };
} {
  return {
    keepass: {
      listDevices: vi.fn<[], Promise<KeePassCredential[]>>().mockResolvedValue(allDevices),
      resolveCredentials: vi
        .fn<[string], Promise<KeePassCredential>>()
        .mockImplementation(async (deviceId: string) => {
          const found = allDevices.find((d) => d.deviceId === deviceId);
          if (!found) throw new Error(`Device "${deviceId}" not found in group`);
          return found;
        }),
    },
    transport: {
      query: vi.fn<[KeePassCredential, string], Promise<Record<string, string>[]>>(),
      execute: vi.fn(),
      raw: vi.fn<[KeePassCredential, string], Promise<string>>(),
    },
    sessionId: 'test-session',
  };
}

describe('fanOut', () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  describe('target = "all"', () => {
    it('calls listDevices and executes callback for each device', async () => {
      const callback = vi.fn().mockResolvedValue('ok');

      const results = await fanOut(deps, 'all', callback);

      expect(deps.keepass.listDevices).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledTimes(3);
      expect(callback).toHaveBeenCalledWith(router01, deps);
      expect(callback).toHaveBeenCalledWith(router02, deps);
      expect(callback).toHaveBeenCalledWith(switch01, deps);
      expect(results).toHaveLength(3);
      expect(results).toEqual([
        { deviceId: 'Router-01', success: true, data: 'ok' },
        { deviceId: 'Router-02', success: true, data: 'ok' },
        { deviceId: 'Switch-01', success: true, data: 'ok' },
      ]);
    });
  });

  describe('target = specific device ID', () => {
    it('calls resolveCredentials and returns single-entry result', async () => {
      const callback = vi.fn().mockResolvedValue({ name: 'Router-01' });

      const results = await fanOut(deps, 'Router-01', callback);

      expect(deps.keepass.resolveCredentials).toHaveBeenCalledWith('Router-01');
      expect(deps.keepass.listDevices).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith(router01, deps);
      expect(results).toEqual([
        { deviceId: 'Router-01', success: true, data: { name: 'Router-01' } },
      ]);
    });
  });

  describe('target = comma-separated device IDs', () => {
    it('resolves each device and fans out in parallel', async () => {
      const callback = vi.fn().mockResolvedValue('ok');

      const results = await fanOut(deps, 'Router-01,Router-02', callback);

      expect(deps.keepass.resolveCredentials).toHaveBeenCalledTimes(2);
      expect(deps.keepass.resolveCredentials).toHaveBeenCalledWith('Router-01');
      expect(deps.keepass.resolveCredentials).toHaveBeenCalledWith('Router-02');
      expect(deps.keepass.listDevices).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(2);
      expect(results).toEqual([
        { deviceId: 'Router-01', success: true, data: 'ok' },
        { deviceId: 'Router-02', success: true, data: 'ok' },
      ]);
    });

    it('handles spaces around commas', async () => {
      const callback = vi.fn().mockResolvedValue('ok');

      const results = await fanOut(deps, 'Router-01 , Switch-01', callback);

      expect(callback).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(2);
      expect(results[0]?.deviceId).toBe('Router-01');
      expect(results[1]?.deviceId).toBe('Switch-01');
    });

    it('returns failed DeviceResult for unknown IDs alongside successes', async () => {
      const callback = vi.fn().mockResolvedValue('ok');

      const results = await fanOut(deps, 'Router-01,BadDevice,Switch-01', callback);

      expect(callback).toHaveBeenCalledTimes(2); // only Router-01 and Switch-01
      expect(results).toHaveLength(3);

      const good = results.filter((r) => r.success);
      const bad = results.filter((r) => !r.success);
      expect(good).toHaveLength(2);
      expect(bad).toHaveLength(1);
      expect(bad[0]?.deviceId).toBe('BadDevice');
      expect(bad[0]?.error).toMatch(/not found/i);
    });

    it('returns all failed if every ID is unknown', async () => {
      const callback = vi.fn().mockResolvedValue('ok');

      const results = await fanOut(deps, 'Bad1,Bad2', callback);

      expect(callback).not.toHaveBeenCalled();
      expect(results).toHaveLength(2);
      expect(results.every((r) => !r.success)).toBe(true);
    });
  });

  describe('partial failure handling', () => {
    it('returns success for working devices and error for failed devices', async () => {
      const callback = vi.fn().mockImplementation(async (cred: KeePassCredential) => {
        if (cred.deviceId === 'Router-02') {
          throw new Error('connect ECONNREFUSED 192.168.1.2:22');
        }
        return `output-${cred.deviceId}`;
      });

      const results = await fanOut(deps, 'all', callback);

      expect(results).toHaveLength(3);

      const r01 = results.find((r) => r.deviceId === 'Router-01');
      const r02 = results.find((r) => r.deviceId === 'Router-02');
      const sw01 = results.find((r) => r.deviceId === 'Switch-01');

      expect(r01).toEqual({ deviceId: 'Router-01', success: true, data: 'output-Router-01' });
      expect(r02?.success).toBe(false);
      expect(r02?.error).toContain('ECONNREFUSED');
      expect(sw01).toEqual({ deviceId: 'Switch-01', success: true, data: 'output-Switch-01' });
    });
  });

  describe('unknown device ID', () => {
    it('returns DeviceResult with success: false and clear error', async () => {
      const callback = vi.fn().mockResolvedValue('ok');

      const results = await fanOut(deps, 'NonExistent-Device', callback);

      expect(results).toHaveLength(1);
      expect(results[0]?.success).toBe(false);
      expect(results[0]?.deviceId).toBe('NonExistent-Device');
      expect(results[0]?.error).toMatch(/not found/i);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('vault-level errors', () => {
    it('propagates listDevices errors (vault not opened)', async () => {
      deps.keepass.listDevices.mockRejectedValue(new Error('Vault not opened'));

      await expect(fanOut(deps, 'all', vi.fn())).rejects.toThrow('Vault not opened');
    });
  });

  describe('credential security', () => {
    it('error messages in DeviceResult never contain credential values', async () => {
      const callback = vi.fn().mockImplementation(async (cred: KeePassCredential) => {
        // Simulate error that pathologically contains credentials
        throw new Error(`Auth failed: user=${cred.username} password=${cred.password}`);
      });

      const results = await fanOut(deps, 'all', callback);

      for (const result of results) {
        if (!result.success && result.error) {
          const cred = allDevices.find((d) => d.deviceId === result.deviceId)!;
          expect(result.error).not.toContain(cred.password);
          expect(result.error).not.toContain(cred.username);
        }
      }
    });
  });

  describe('callback receives correct credentials', () => {
    it('passes the matching KeePassCredential to each callback invocation', async () => {
      const receivedCreds: KeePassCredential[] = [];
      const callback = vi.fn().mockImplementation(async (cred: KeePassCredential) => {
        receivedCreds.push(cred);
        return 'ok';
      });

      await fanOut(deps, 'all', callback);

      expect(receivedCreds).toHaveLength(3);
      expect(receivedCreds).toContainEqual(router01);
      expect(receivedCreds).toContainEqual(router02);
      expect(receivedCreds).toContainEqual(switch01);
    });
  });
});
