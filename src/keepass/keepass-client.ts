/**
 * KeePass credential client — resolves device credentials from a .kdbx vault.
 * This is the SOLE owner of vault access per architecture boundaries.
 */
import { readFile, writeFile } from 'node:fs/promises';
import kdbxweb from 'kdbxweb';
import argon2 from 'argon2';
import type { KeePassClient, KeePassCredential, CreateEntryParams } from '../types/index.js';

// Configure Argon2 implementation for kdbxweb (required for KDBX4 vaults)
kdbxweb.CryptoEngine.setArgon2Impl(
  (
    password: ArrayBuffer,
    salt: ArrayBuffer,
    memory: number,
    iterations: number,
    length: number,
    parallelism: number,
    type: number,
    version: number,
  ) =>
    argon2
      .hash(Buffer.from(password), {
        salt: Buffer.from(salt),
        memoryCost: memory,
        timeCost: iterations,
        hashLength: length,
        parallelism,
        type: type as 0 | 1 | 2,
        version: version as number,
        raw: true,
      })
      .then((buf: Buffer) => new Uint8Array(buf).buffer as ArrayBuffer),
);

export class KeePassClientImpl implements KeePassClient {
  private readonly vaultPath: string;
  private readonly password: string;
  private readonly groupName: string;
  private validated = false;

  constructor(vaultPath: string, password: string, groupName: string) {
    this.vaultPath = vaultPath;
    this.password = password;
    this.groupName = groupName;
  }

  /**
   * Validates the vault can be opened and the target group exists.
   * Called once at startup to fail-fast on misconfiguration.
   * The vault is re-read from disk on every subsequent access to pick up changes.
   */
  async open(): Promise<void> {
    // Validate once at startup; actual reads happen per-call
    await this.loadVaultAndGroup();
    this.validated = true;
  }

  async listDevices(): Promise<KeePassCredential[]> {
    this.ensureOpen();
    const { group } = await this.loadVaultAndGroup();
    return group.entries.map((entry) => this.entryToCredential(entry));
  }

  async resolveCredentials(deviceId: string): Promise<KeePassCredential> {
    this.ensureOpen();
    const { group } = await this.loadVaultAndGroup();

    const entry = group.entries.find((e) => {
      const title = e.fields.get('Title');
      return this.fieldToString(title) === deviceId;
    });

    if (!entry) {
      throw new Error(`Device "${deviceId}" not found in KeePass group "${this.groupName}"`);
    }

    return this.entryToCredential(entry);
  }

  async createEntry(params: CreateEntryParams): Promise<void> {
    this.ensureOpen();
    const { db, group } = await this.loadVaultAndGroup();

    // Prevent duplicate entries
    const existing = group.entries.find(
      (e) => this.fieldToString(e.fields.get('Title')) === params.deviceId,
    );
    if (existing) {
      throw new Error(
        `Entry "${params.deviceId}" already exists in KeePass group "${this.groupName}"`,
      );
    }

    const entry = db.createEntry(group);
    entry.fields.set('Title', params.deviceId);
    entry.fields.set('UserName', params.username);
    entry.fields.set('Password', kdbxweb.ProtectedValue.fromString(params.password));
    entry.fields.set('URL', params.hostname);
    if (params.notes) {
      entry.fields.set('Notes', params.notes);
    }

    const arrayBuffer = await db.save();
    await writeFile(this.vaultPath, Buffer.from(arrayBuffer));
  }

  private ensureOpen(): void {
    if (!this.validated) {
      throw new Error('KeePass vault not opened. Call open() before accessing credentials.');
    }
  }

  /**
   * Re-reads and parses the vault from disk every time,
   * so external changes (e.g. adding/editing entries) are picked up immediately.
   * Returns both the database handle (needed for writes) and the target group.
   */
  private async loadVaultAndGroup(): Promise<{ db: kdbxweb.Kdbx; group: kdbxweb.KdbxGroup }> {
    if (!this.password) {
      throw new Error('KeePass vault password is required but was not provided');
    }

    let data: ArrayBuffer;
    try {
      const buffer = await readFile(this.vaultPath);
      data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } catch {
      throw new Error(
        `KeePass vault file not accessible at configured path. Verify KEEPASS_PATH is correct.`,
      );
    }

    const credentials = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(this.password));

    let db: kdbxweb.Kdbx;
    try {
      db = await kdbxweb.Kdbx.load(data, credentials);
    } catch {
      throw new Error('Failed to open KeePass vault. Verify the vault password is correct.');
    }

    const defaultGroup = db.getDefaultGroup();
    const targetGroup = this.findGroup(defaultGroup, this.groupName);

    if (!targetGroup) {
      throw new Error(
        `KeePass group "${this.groupName}" not found in vault. Verify KEEPASS_GROUP is correct.`,
      );
    }

    return { db, group: targetGroup };
  }

  private findGroup(parent: kdbxweb.KdbxGroup, name: string): kdbxweb.KdbxGroup | undefined {
    for (const group of parent.groups) {
      if (group.name === name) {
        return group;
      }
      const nested = this.findGroup(group, name);
      if (nested) return nested;
    }
    return undefined;
  }

  private entryToCredential(entry: kdbxweb.KdbxEntry): KeePassCredential {
    return {
      deviceId: this.fieldToString(entry.fields.get('Title')),
      username: this.fieldToString(entry.fields.get('UserName')),
      password: this.fieldToString(entry.fields.get('Password')),
      hostname: this.fieldToString(entry.fields.get('URL')),
      notes: this.fieldToString(entry.fields.get('Notes')),
    };
  }

  private fieldToString(value: kdbxweb.KdbxEntryField | undefined): string {
    if (value === undefined || value === null) return '';
    if (value instanceof kdbxweb.ProtectedValue) {
      return value.getText();
    }
    return String(value);
  }
}
