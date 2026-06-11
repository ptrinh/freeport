import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import * as nip49 from 'nostr-tools/nip49';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function dataDir(profile = 'default'): string {
  const dir = join(homedir(), '.freeport', profile);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Load the identity key, generating one silently on first use (no signup). */
export function loadOrCreateKey(profile = 'default'): Uint8Array {
  const path = join(dataDir(profile), 'key');
  if (existsSync(path)) {
    return nip19.decode(readFileSync(path, 'utf8').trim()).data as Uint8Array;
  }
  const sk = generateSecretKey();
  writeFileSync(path, nip19.nsecEncode(sk) + '\n', { mode: 0o600 });
  return sk;
}

export function npub(sk: Uint8Array): string {
  return nip19.npubEncode(getPublicKey(sk));
}

/**
 * NIP-49 passphrase-encrypted backup (ncryptsec…). The blob is safe to store
 * with any provider — it is unreadable without the passphrase.
 */
export function encryptedBackup(sk: Uint8Array, passphrase: string): string {
  return nip49.encrypt(sk, passphrase);
}

export function restoreFromBackup(ncryptsec: string, passphrase: string, profile = 'default'): Uint8Array {
  const sk = nip49.decrypt(ncryptsec, passphrase);
  const path = join(dataDir(profile), 'key');
  writeFileSync(path, nip19.nsecEncode(sk) + '\n', { mode: 0o600 });
  return sk;
}
