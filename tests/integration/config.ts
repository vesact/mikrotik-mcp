/**
 * Integration test device configuration.
 *
 * Devices are configured via environment variables or a .env.test file.
 * Each device is identified by a slot (DEVICE_1, DEVICE_2, etc.)
 *
 * Environment variables:
 *   TEST_DEVICE_1_HOST=10.0.0.1
 *   TEST_DEVICE_1_USER=admin
 *   TEST_DEVICE_1_PASS=password
 *   TEST_DEVICE_1_TYPE=physical|chr
 *   TEST_DEVICE_1_PORT=80        (optional, default 80)
 *   TEST_DEVICE_1_SCHEME=http    (optional, default http)
 *
 * Tags for filtering:
 *   TEST_TAGS=physical,single    (run only tests matching these tags)
 */

export interface TestDevice {
  id: string;
  host: string;
  user: string;
  pass: string;
  type: 'physical' | 'chr';
  port: number;
  scheme: 'http' | 'https';
}

export interface TestConfig {
  devices: TestDevice[];
  tags: string[];
  timeoutMs: number;
}

export function loadTestConfig(): TestConfig {
  const devices: TestDevice[] = [];

  for (let i = 1; i <= 4; i++) {
    const prefix = `TEST_DEVICE_${i}`;
    const host = process.env[`${prefix}_HOST`];
    if (!host) continue;

    devices.push({
      id: `device-${i}`,
      host,
      user: process.env[`${prefix}_USER`] ?? 'admin',
      pass: process.env[`${prefix}_PASS`] ?? '',
      type: (process.env[`${prefix}_TYPE`] as 'physical' | 'chr') ?? 'physical',
      port: parseInt(process.env[`${prefix}_PORT`] ?? '80', 10),
      scheme: (process.env[`${prefix}_SCHEME`] as 'http' | 'https') ?? 'http',
    });
  }

  const tags = (process.env['TEST_TAGS'] ?? '').split(',').filter(Boolean);
  const timeoutMs = parseInt(process.env['TEST_TIMEOUT_MS'] ?? '15000', 10);

  return { devices, tags, timeoutMs };
}

export function requireDevices(config: TestConfig, min = 1): TestDevice[] {
  if (config.devices.length < min) {
    throw new Error(
      `Integration tests require at least ${min} device(s). ` +
        `Set TEST_DEVICE_1_HOST (and TEST_DEVICE_1_USER, TEST_DEVICE_1_PASS) env vars. ` +
        `Found ${config.devices.length} device(s) configured.`,
    );
  }
  return config.devices;
}
