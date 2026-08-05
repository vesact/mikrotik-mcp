/**
 * Fan-out utility — executes a callback against one or all devices in parallel.
 * Every tool handler delegates to this function for target resolution and parallel execution.
 *
 * Architectural mandate: always use Promise.allSettled, never Promise.all.
 */
import type { ToolDeps, KeePassCredential, DeviceResult } from './types/index.js';

/** Callback executed per device during fan-out. */
export type DeviceCallback = (credential: KeePassCredential, deps: ToolDeps) => Promise<unknown>;

/**
 * Resolve target to device credentials and execute callback per device.
 *
 * - `target = "all"`: calls `listDevices()`, fans out to every device
 * - `target = "A,B,C"`: comma-separated device IDs, fans out to those devices
 * - `target = "<deviceId>"`: single device only
 *
 * Per-device errors are captured in `DeviceResult.error` (never thrown).
 * Vault-level errors (e.g., vault not opened) propagate to the caller.
 * Credential values are never exposed in error messages.
 */
export async function fanOut(
  deps: ToolDeps,
  target: string,
  callback: DeviceCallback,
): Promise<DeviceResult[]> {
  let credentials: KeePassCredential[];

  if (target === 'all') {
    credentials = await deps.keepass.listDevices();
  } else {
    // Split on comma to support multi-target: "R1,R2,R3"
    const ids = target
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const resolved: KeePassCredential[] = [];
    const failed: DeviceResult[] = [];

    for (const id of ids) {
      try {
        resolved.push(await deps.keepass.resolveCredentials(id));
      } catch (err: unknown) {
        failed.push({
          deviceId: id,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (resolved.length === 0) return failed;

    credentials = resolved;

    // Execute resolved devices, then append any credential failures
    const results = await executeAll(deps, credentials, callback);
    return [...results, ...failed];
  }

  return executeAll(deps, credentials, callback);
}

/** Execute callback per device using Promise.allSettled (architecture mandate). */
async function executeAll(
  deps: ToolDeps,
  credentials: KeePassCredential[],
  callback: DeviceCallback,
): Promise<DeviceResult[]> {
  const results = await Promise.allSettled(credentials.map((cred) => callback(cred, deps)));

  return results.map((result, i) => {
    const cred = credentials[i];
    if (result.status === 'fulfilled') {
      return { deviceId: cred.deviceId, success: true, data: result.value };
    }
    return {
      deviceId: cred.deviceId,
      success: false,
      error: sanitizeError(result.reason, cred),
    };
  });
}

/** Strip credential values from error messages (NFR-SEC-1). */
function sanitizeError(err: unknown, credential: KeePassCredential): string {
  const message = err instanceof Error ? err.message : String(err);
  let sanitized = message;
  if (credential.password) {
    sanitized = sanitized.replaceAll(credential.password, '[REDACTED]');
  }
  if (credential.username) {
    sanitized = sanitized.replaceAll(credential.username, '[REDACTED]');
  }
  return sanitized;
}
