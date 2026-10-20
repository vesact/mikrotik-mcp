import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnvCredentialProvider } from '../../../src/credentials/env-provider.js';
import { FileCredentialProvider } from '../../../src/credentials/file-provider.js';
import { createCredentialProvider, resolveProviderKind } from '../../../src/credentials/index.js';
import { supportsWrite } from '../../../src/tools/setup.js';

const DEVICES = [
  { id: 'r1', host: '192.0.2.1', password: 'pw-one' },
  { id: 'r2', host: '192.0.2.2', user: 'ops', password: 'pw-two', notes: 'rack 4' },
];

describe('resolveProviderKind', () => {
  it('defaults to keepass when nothing is set', () => {
    expect(resolveProviderKind({})).toBe('keepass');
  });

  it('infers each provider from its variables', () => {
    expect(resolveProviderKind({ KEEPASS_PASSWORD: 'x' })).toBe('keepass');
    expect(resolveProviderKind({ DEVICES_FILE: '/config/devices.json' })).toBe('file');
    expect(resolveProviderKind({ DEVICE_HOST: '192.0.2.1' })).toBe('env');
    expect(resolveProviderKind({ DEVICES: '[]' })).toBe('env');
  });

  it('lets CREDENTIAL_PROVIDER override inference', () => {
    expect(resolveProviderKind({ CREDENTIAL_PROVIDER: 'ENV', KEEPASS_PASSWORD: 'x' })).toBe('env');
  });

  it('rejects an unknown provider', () => {
    expect(() => resolveProviderKind({ CREDENTIAL_PROVIDER: 'vault' })).toThrow(
      'Unknown CREDENTIAL_PROVIDER "vault"',
    );
  });

  it('refuses to guess when several providers are configured', () => {
    expect(() => resolveProviderKind({ KEEPASS_PASSWORD: 'x', DEVICE_HOST: '192.0.2.1' })).toThrow(
      'several providers (keepass, env)',
    );
  });
});

describe('EnvCredentialProvider', () => {
  it('builds a single device with id and user defaults', async () => {
    const provider = new EnvCredentialProvider({
      DEVICE_HOST: '192.0.2.1',
      DEVICE_PASSWORD: 'pw',
    });
    expect(await provider.listDevices()).toEqual([
      {
        deviceId: '192.0.2.1',
        username: 'admin',
        password: 'pw',
        hostname: '192.0.2.1',
        notes: '',
      },
    ]);
  });

  it('reads several devices from DEVICES', async () => {
    const provider = new EnvCredentialProvider({ DEVICES: JSON.stringify(DEVICES) });
    const r2 = await provider.resolveCredentials('r2');
    expect(r2).toEqual({
      deviceId: 'r2',
      username: 'ops',
      password: 'pw-two',
      hostname: '192.0.2.2',
      notes: 'rack 4',
    });
    await expect(provider.resolveCredentials('r3')).rejects.toThrow('Device "r3" not found');
  });

  it('is read-only', () => {
    const provider = new EnvCredentialProvider({ DEVICE_HOST: 'h', DEVICE_PASSWORD: 'p' });
    expect(supportsWrite(provider)).toBe(false);
  });

  it.each([
    [{}, 'needs DEVICE_HOST or DEVICES'],
    [{ DEVICE_HOST: 'h' }, 'DEVICE_PASSWORD is required'],
    [{ DEVICES: '[', DEVICE_HOST: 'h' }, 'not both'],
    [{ DEVICES: '{not json' }, 'not valid JSON'],
    [{ DEVICES: '[]' }, 'Invalid device list in DEVICES'],
    [{ DEVICES: '[{"id":"a","password":"p"}]' }, 'at 0.host'],
    [
      { DEVICES: '[{"id":"a","host":"h","password":"p"},{"id":"a","host":"i","password":"q"}]' },
      'Duplicate device ID "a"',
    ],
  ])('rejects %j', (env, message) => {
    expect(() => new EnvCredentialProvider(env)).toThrow(message);
  });

  it('never puts a password in a validation error', () => {
    const env = {
      DEVICES:
        '[{"id":"a","host":"h","password":"hunter2"},{"id":"a","host":"i","password":"hunter3"}]',
    };
    expect(() => new EnvCredentialProvider(env)).toThrow(/^(?!.*hunter).*Duplicate/);
  });
});

describe('FileCredentialProvider', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'devices-test-'));
    path = join(dir, 'devices.json');
    await writeFile(path, JSON.stringify(DEVICES));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lists and resolves devices from the file', async () => {
    const provider = new FileCredentialProvider(path);
    await provider.open();
    expect((await provider.listDevices()).map((d) => d.deviceId)).toEqual(['r1', 'r2']);
    expect((await provider.resolveCredentials('r1')).password).toBe('pw-one');
  });

  it('picks up edits without a restart', async () => {
    const provider = new FileCredentialProvider(path);
    await provider.open();
    await writeFile(
      path,
      JSON.stringify([...DEVICES, { id: 'r3', host: '192.0.2.3', password: 'x' }]),
    );
    expect(await provider.listDevices()).toHaveLength(3);
  });

  it('fails fast on a missing or invalid file', async () => {
    await expect(new FileCredentialProvider(join(dir, 'nope.json')).open()).rejects.toThrow(
      'Device file not accessible',
    );
    await writeFile(path, 'not json');
    await expect(new FileCredentialProvider(path).open()).rejects.toThrow('not valid JSON');
  });

  it('is read-only', () => {
    expect(supportsWrite(new FileCredentialProvider(path))).toBe(false);
  });

  it('is selected and opened by createCredentialProvider', async () => {
    const { kind, provider } = await createCredentialProvider({ DEVICES_FILE: path });
    expect(kind).toBe('file');
    expect(await provider.listDevices()).toHaveLength(2);
  });
});
