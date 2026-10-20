/**
 * Credential provider selection. Picks the provider from CREDENTIAL_PROVIDER,
 * or infers it from which variables are set, then opens it (fail-fast).
 */
import { KeePassClientImpl } from '../keepass/keepass-client.js';
import type { CredentialProvider } from '../types/index.js';
import { EnvCredentialProvider } from './env-provider.js';
import { FileCredentialProvider } from './file-provider.js';

export type ProviderKind = 'keepass' | 'env' | 'file';

const PROVIDER_KINDS: readonly ProviderKind[] = ['keepass', 'env', 'file'];

/**
 * Explicit CREDENTIAL_PROVIDER wins. Otherwise: KEEPASS_PASSWORD → keepass,
 * DEVICES_FILE → file, DEVICE_HOST or DEVICES → env. With none of them set,
 * keepass stays the default so existing deployments behave as before.
 */
export function resolveProviderKind(env: NodeJS.ProcessEnv): ProviderKind {
  const explicit = env.CREDENTIAL_PROVIDER?.trim().toLowerCase();
  if (explicit) {
    if (!(PROVIDER_KINDS as readonly string[]).includes(explicit)) {
      throw new Error(
        `Unknown CREDENTIAL_PROVIDER "${env.CREDENTIAL_PROVIDER}"; expected one of ${PROVIDER_KINDS.join(', ')}`,
      );
    }
    return explicit as ProviderKind;
  }

  const candidates: ProviderKind[] = [];
  if (env.KEEPASS_PASSWORD) candidates.push('keepass');
  if (env.DEVICES_FILE) candidates.push('file');
  if (env.DEVICE_HOST || env.DEVICES) candidates.push('env');

  if (candidates.length > 1) {
    throw new Error(
      `Credentials are configured for several providers (${candidates.join(', ')}); set CREDENTIAL_PROVIDER to pick one`,
    );
  }
  return candidates[0] ?? 'keepass';
}

/** Build and open the configured provider. Throws with a clear message on misconfiguration. */
export async function createCredentialProvider(
  env: NodeJS.ProcessEnv,
): Promise<{ kind: ProviderKind; provider: CredentialProvider }> {
  const kind = resolveProviderKind(env);

  switch (kind) {
    case 'keepass': {
      const provider = new KeePassClientImpl(
        env.KEEPASS_PATH ?? '/config/keepass.kdbx',
        env.KEEPASS_PASSWORD ?? '',
        env.KEEPASS_GROUP ?? 'mikrotik',
      );
      await provider.open();
      return { kind, provider };
    }
    case 'file': {
      if (!env.DEVICES_FILE) {
        throw new Error('CREDENTIAL_PROVIDER=file needs DEVICES_FILE');
      }
      const provider = new FileCredentialProvider(env.DEVICES_FILE);
      await provider.open();
      return { kind, provider };
    }
    case 'env':
      return { kind, provider: new EnvCredentialProvider(env) };
  }
}
