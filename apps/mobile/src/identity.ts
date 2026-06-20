/**
 * Identity for the mobile app: keypair generated silently on first launch,
 * stored in the platform keystore (SecureStore). Backup = NIP-49 ncryptsec
 * blob the user can copy anywhere — provider-storable, provider-unreadable.
 */
import 'react-native-get-random-values';
import { kvGet, kvSet, kvDelete } from './kv';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import * as nip49 from 'nostr-tools/nip49';

const KEY = 'freeport.nsec';

export async function loadOrCreateKey(): Promise<Uint8Array> {
  const stored = await kvGet(KEY);
  if (stored) return nip19.decode(stored).data as Uint8Array;
  const sk = generateSecretKey();
  await kvSet(KEY, nip19.nsecEncode(sk));
  return sk;
}

/** True if an identity key is already stored on this device. */
export async function hasStoredKey(): Promise<boolean> {
  return !!(await kvGet(KEY));
}

/** Load the stored key, or null if none (first launch). Never creates. */
export async function loadKey(): Promise<Uint8Array | null> {
  const stored = await kvGet(KEY);
  return stored ? (nip19.decode(stored).data as Uint8Array) : null;
}

/** Generate and store a fresh identity key. */
export async function createKey(): Promise<Uint8Array> {
  const sk = generateSecretKey();
  await kvSet(KEY, nip19.nsecEncode(sk));
  return sk;
}

/** Erase the stored identity key (sign out). Irrecoverable without a backup file. */
export async function clearKey(): Promise<void> {
  await kvDelete(KEY);
}

/** The raw stored nsec string (for cloud backup), or null if none. */
export async function getStoredNsec(): Promise<string | null> {
  return (await kvGet(KEY)) ?? null;
}

/** Restore from a bare nsec (e.g. one fetched from cloud backup). Validates, stores, returns the key. */
export async function restoreNsec(nsec: string): Promise<Uint8Array> {
  const decoded = nip19.decode(nsec.trim());
  if (decoded.type !== 'nsec') throw new Error('Not a valid key backup.');
  const sk = decoded.data as Uint8Array;
  await kvSet(KEY, nip19.nsecEncode(sk));
  return sk;
}

export function npubOf(sk: Uint8Array): string {
  return nip19.npubEncode(getPublicKey(sk));
}

/** npub for a hex pubkey (e.g. one returned by a NIP-07 extension). */
export function npubFromHex(pubkeyHex: string): string {
  return nip19.npubEncode(pubkeyHex);
}

export function makeBackup(sk: Uint8Array, passphrase: string): string {
  return nip49.encrypt(sk, passphrase);
}

export async function restoreBackup(ncryptsec: string, passphrase: string): Promise<Uint8Array> {
  const sk = nip49.decrypt(ncryptsec, passphrase);
  await kvSet(KEY, nip19.nsecEncode(sk));
  return sk;
}

/**
 * Backup file content. With a passphrase → NIP-49 ncryptsec (unreadable
 * without it). Without → plain nsec (the file itself IS the key — fine if
 * it lives somewhere already protected, like the user's iCloud Drive).
 */
export function backupFileContent(sk: Uint8Array, passphrase: string): string {
  return passphrase ? nip49.encrypt(sk, passphrase) : nip19.nsecEncode(sk);
}

/** What a backup file contains, detected from its bech32 prefix. */
export function backupKind(text: string): 'encrypted' | 'plain' | 'unknown' {
  const t = text.trim();
  if (t.startsWith('ncryptsec1')) return 'encrypted';
  if (t.startsWith('nsec1')) return 'plain';
  return 'unknown';
}

/** Extras bundled alongside the key in a backup file (profile + settings +
 *  address book + small local flags: account-created timestamp, rated-deal ids). */
export interface BackupExtras { profile?: unknown; prefs?: unknown; addressBook?: unknown; created?: unknown; rated?: unknown }

/**
 * Parse a backup file. Supports the JSON bundle (key + prefs + address book)
 * and the legacy bare nsec/ncryptsec. Writes the restored key to storage and
 * returns the key plus any extras for the caller to apply.
 */
export async function parseBackupBundle(
  text: string,
  passphrase: string,
): Promise<{ sk: Uint8Array } & BackupExtras> {
  const t = text.trim();
  try {
    const o = JSON.parse(t);
    if (o && typeof o === 'object' && typeof o.key === 'string') {
      const sk = await restoreFromText(o.key, passphrase);
      return { sk, profile: o.profile, prefs: o.prefs, addressBook: o.addressBook, created: o.created, rated: o.rated };
    }
  } catch {
    // not JSON → fall through to bare-key handling
  }
  return { sk: await restoreFromText(t, passphrase) };
}

/** Restore from backup-file text (either ncryptsec or plain nsec). */
export async function restoreFromText(text: string, passphrase: string): Promise<Uint8Array> {
  const t = text.trim();
  const kind = backupKind(t);
  if (kind === 'unknown') throw new Error('Not a Freeport identity backup file.');
  let sk: Uint8Array;
  if (kind === 'encrypted') {
    if (!passphrase) throw new Error('This backup is encrypted — enter its passphrase.');
    sk = nip49.decrypt(t, passphrase);
  } else {
    const decoded = nip19.decode(t);
    if (decoded.type !== 'nsec') throw new Error('Not a valid key backup.');
    sk = decoded.data as Uint8Array;
  }
  await kvSet(KEY, nip19.nsecEncode(sk));
  return sk;
}
