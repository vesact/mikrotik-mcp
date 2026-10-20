/**
 * Shared device-list format for the env and file credential providers.
 * Error messages name the failing field, never its value.
 */
import { z } from 'zod';
import type { DeviceCredential } from '../types/index.js';

const deviceSchema = z.object({
  id: z.string().min(1).optional(),
  host: z.string().min(1),
  user: z.string().min(1).optional(),
  password: z.string(),
  notes: z.string().optional(),
});

/** Raw entry as written by the operator. */
export type DeviceEntry = z.infer<typeof deviceSchema>;

/** Convert an entry: `id` defaults to the host, `user` to RouterOS's default `admin`. */
export function toCredential(entry: DeviceEntry): DeviceCredential {
  return {
    deviceId: entry.id ?? entry.host,
    username: entry.user ?? 'admin',
    password: entry.password,
    hostname: entry.host,
    notes: entry.notes ?? '',
  };
}

/**
 * Validate a device list and reject duplicate IDs.
 * `source` names where the list came from (e.g. "DEVICES", a file path) for error messages.
 */
export function parseDeviceList(raw: unknown, source: string): DeviceCredential[] {
  const parsed = z.array(deviceSchema).min(1).safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
    throw new Error(`Invalid device list in ${source}${where}: ${issue.message}`);
  }

  const devices = parsed.data.map(toCredential);
  const seen = new Set<string>();
  for (const d of devices) {
    if (seen.has(d.deviceId)) {
      throw new Error(`Duplicate device ID "${d.deviceId}" in ${source}`);
    }
    seen.add(d.deviceId);
  }
  return devices;
}

/** Look a device up by ID, with the same error shape across providers. */
export function findDevice(
  devices: DeviceCredential[],
  deviceId: string,
  source: string,
): DeviceCredential {
  const device = devices.find((d) => d.deviceId === deviceId);
  if (!device) {
    throw new Error(`Device "${deviceId}" not found in ${source}`);
  }
  return device;
}
