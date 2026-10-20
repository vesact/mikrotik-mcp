/**
 * Credential provider backed by a JSON inventory file. Read-only.
 * The file is re-read on every call, like the KeePass vault, so edits apply
 * without a restart. Format: the same array as the DEVICES variable.
 */
import { readFile } from 'node:fs/promises';
import type { CredentialProvider, DeviceCredential } from '../types/index.js';
import { findDevice, parseDeviceList } from './device-list.js';

export class FileCredentialProvider implements CredentialProvider {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /** Validates the file once at startup to fail fast on misconfiguration. */
  async open(): Promise<void> {
    await this.load();
  }

  async listDevices(): Promise<DeviceCredential[]> {
    return this.load();
  }

  async resolveCredentials(deviceId: string): Promise<DeviceCredential> {
    return findDevice(await this.load(), deviceId, this.path);
  }

  private async load(): Promise<DeviceCredential[]> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch {
      throw new Error('Device file not accessible at configured path. Verify DEVICES_FILE.');
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(`${this.path} is not valid JSON; expected an array of devices`);
    }
    return parseDeviceList(raw, this.path);
  }
}
