/**
 * Credential provider backed by environment variables. Read-only.
 *
 * Single device:  DEVICE_HOST, DEVICE_PASSWORD, optional DEVICE_USER / DEVICE_ID / DEVICE_NOTES
 * Several:        DEVICES='[{"id":"r1","host":"192.0.2.1","password":"…"}, …]'
 */
import type { CredentialProvider, DeviceCredential } from '../types/index.js';
import { findDevice, parseDeviceList } from './device-list.js';

export class EnvCredentialProvider implements CredentialProvider {
  private readonly devices: DeviceCredential[];
  private readonly source: string;

  constructor(env: NodeJS.ProcessEnv) {
    if (env.DEVICES && env.DEVICE_HOST) {
      throw new Error('Set either DEVICES or DEVICE_HOST, not both');
    }

    if (env.DEVICES) {
      this.source = 'DEVICES';
      let raw: unknown;
      try {
        raw = JSON.parse(env.DEVICES);
      } catch {
        throw new Error('DEVICES is not valid JSON; expected an array of devices');
      }
      this.devices = parseDeviceList(raw, this.source);
      return;
    }

    if (!env.DEVICE_HOST) {
      throw new Error('The env credential provider needs DEVICE_HOST or DEVICES');
    }
    if (env.DEVICE_PASSWORD === undefined) {
      throw new Error('DEVICE_PASSWORD is required with DEVICE_HOST');
    }
    this.source = 'DEVICE_* environment variables';
    this.devices = parseDeviceList(
      [
        {
          id: env.DEVICE_ID || undefined,
          host: env.DEVICE_HOST,
          user: env.DEVICE_USER || undefined,
          password: env.DEVICE_PASSWORD,
          notes: env.DEVICE_NOTES || undefined,
        },
      ],
      this.source,
    );
  }

  async listDevices(): Promise<DeviceCredential[]> {
    return this.devices;
  }

  async resolveCredentials(deviceId: string): Promise<DeviceCredential> {
    return findDevice(this.devices, deviceId, this.source);
  }
}
