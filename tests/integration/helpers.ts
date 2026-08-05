/**
 * Integration test helpers — create a real transport connected to test devices.
 */
import { RestTransportImpl } from '../../src/rest/rest-transport.js';
import type { DeviceTransport, KeePassCredential, RosRecord } from '../../src/types/index.js';
import type { TestDevice } from './config.js';

/** Create a transport instance configured for a test device. */
export function createTransport(device: TestDevice): DeviceTransport {
  return new RestTransportImpl({
    port: device.port,
    scheme: device.scheme,
    timeoutMs: 15000,
  });
}

/** Create a KeePassCredential-like object from a test device. */
export function toCredential(device: TestDevice): KeePassCredential {
  return {
    deviceId: device.id,
    username: device.user,
    password: device.pass,
    hostname: device.host,
    notes: '',
  };
}

/**
 * Assert that a query result is a non-empty array of records.
 * Returns the records for further assertions.
 */
export function assertRecords(result: RosRecord[], minCount = 1): RosRecord[] {
  if (!Array.isArray(result)) {
    throw new Error(`Expected array, got ${typeof result}`);
  }
  if (result.length < minCount) {
    throw new Error(`Expected at least ${minCount} records, got ${result.length}`);
  }
  return result;
}

/**
 * Assert that a record has expected keys (at minimum).
 */
export function assertHasKeys(record: RosRecord, keys: string[]): void {
  const missing = keys.filter((k) => !(k in record));
  if (missing.length > 0) {
    throw new Error(
      `Record missing keys: ${missing.join(', ')}. Got: ${Object.keys(record).join(', ')}`,
    );
  }
}
