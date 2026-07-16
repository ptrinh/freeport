/**
 * Identity for the mobile app: keypair generated silently on first launch,
 * stored in the platform keystore (SecureStore). Backup = NIP-49 ncryptsec
 * blob the user can copy anywhere — provider-storable, provider-unreadable.
 */
import 'react-native-get-random-values';
import { kvGet, kvSet, kvDelete } from './kv';
import { kvCacheDelete } from './kvCache';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import * as nip49 from 'nostr-tools/nip49';
import { encrypt as nip44Encrypt, decrypt as nip44Decrypt } from 'nostr-tools/nip44';

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

/**
 * Permanently erase ALL on-device account data — the identity key plus every
 * piece of local state tied to it (profile, settings, negotiations, posts,
 * address book, push token, and assorted flags). Used by "Delete account".
 * Irrecoverable. Caller is responsible for any network-side cleanup (withdraw
 * intents, blank the public profile, remove cloud backup) BEFORE calling this,
 * since that needs the key.
 */
export async function wipeAllLocalData(): Promise<void> {
  const KEYS = [
    'freeport.nsec', 'freeport.profile', 'freeport.prefs', 'freeport.negotiations',
    'freeport.published', 'freeport.outbox', 'freeport.dmLastSeen', 'freeport.addressbook', 'freeport.created', 'freeport.rated', 'freeport.ratingSkipped',
    'freeport.celebrated', 'freeport.expiredLog', 'freeport.expiredSeen',
    'freeport.expoPushToken', 'freeport.geoOk', 'freeport.guidanceSeen', 'freeport.notifDismiss',
    'freeport.pushOn', 'freeport.autoContactSent', 'freeport.suspendNotifiedAt',
    // Mini-app grants are per-identity: an app trusted to sign as account A
    // must never inherit that trust for account B.
    'freeport.miniapps',
    // Sensitive residue "Delete account" must not leave behind — escrow
    // preimages are spendable funds; conversations are private DM history; the
    // chat-invite key is a standing secret. On web these live in localStorage,
    // so a later account on the same browser could otherwise read them.
    'freeport.escrows', 'freeport.conversations', 'freeport.chatInvite',
  ];
  await Promise.all(KEYS.map((k) => kvDelete(k).catch(() => {})));
  // Bulk caches (deals, chats, escrows, outbox…) live in kvCache (files on
  // native) — wipe those copies too, plus any unmigrated SecureStore residue.
  const CACHE_KEYS = [
    'freeport.negotiations', 'freeport.published', 'freeport.outbox',
    'freeport.dmLastSeen', 'freeport.escrows', 'freeport.conversations',
  ];
  await Promise.all(CACHE_KEYS.map((k) => kvCacheDelete(k).catch(() => {})));
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
export interface BackupExtras { profile?: unknown; prefs?: unknown; addressBook?: unknown; created?: unknown; rated?: unknown; miniapps?: unknown }

/**
 * Assemble the final backup file text from an inner bundle object.
 *
 * WITHOUT a passphrase → the plaintext v1 bundle (`key` is a bare nsec; the
 * user opted out of protection). WITH a passphrase → a v2 envelope that
 * encrypts the ENTIRE bundle, so the passphrase protects the wallet-connect
 * (NWC) credential and phone number in `prefs`/`profile`, not just the key.
 * The inner `key` is a bare nsec because the whole body is already encrypted.
 *
 * v2 mechanics: a random 32-byte data key is wrapped with the passphrase via
 * NIP-49 (scrypt) and used as the NIP-44 key for the body — reusing audited
 * primitives, with NIP-49's per-backup salt.
 */
export function finalizeBackupBundle(inner: Record<string, unknown>, passphrase: string): string {
  const body = JSON.stringify({ v: 1, app: 'freeport', ...inner });
  if (!passphrase) return body;
  const dk = generateSecretKey();
  return JSON.stringify({ v: 2, app: 'freeport', wrap: nip49.encrypt(dk, passphrase), enc: nip44Encrypt(body, dk) });
}

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
  let o: Record<string, unknown> | undefined;
  try { o = JSON.parse(t); } catch { /* not JSON → bare key below */ }

  // v2: the whole bundle is encrypted under the passphrase — unwrap first. A
  // failure here (wrong passphrase, tampered file) MUST throw, never fall
  // through to the bare-key path (which would give a misleading error).
  if (o && typeof o === 'object' && o.v === 2 && typeof o.enc === 'string' && typeof o.wrap === 'string') {
    if (!passphrase) throw new Error('This backup is encrypted — enter its passphrase.');
    let dk: Uint8Array;
    try { dk = nip49.decrypt(o.wrap, passphrase); }
    catch { throw new Error('Wrong passphrase for this backup.'); }
    try { o = JSON.parse(nip44Decrypt(o.enc, dk)); }
    catch { throw new Error('This backup is corrupt or was tampered with.'); }
  }

  if (o && typeof o === 'object' && typeof o.key === 'string') {
    // A v2 inner key is already plaintext (the body was encrypted); a v1 key
    // may itself be an ncryptsec needing the same passphrase.
    const sk = await restoreFromText(o.key, passphrase);
    return { sk, profile: o.profile, prefs: o.prefs, addressBook: o.addressBook, created: o.created, rated: o.rated, miniapps: o.miniapps };
  }
  return { sk: await restoreFromText(t, passphrase) };
}

/**
 * Does this backup text (JSON bundle or bare key) need a passphrase to
 * restore? Lets the UI collect one BEFORE attempting the restore, instead of
 * failing with "enter its passphrase" and nowhere to enter it.
 */
export function bundleNeedsPassphrase(text: string): boolean {
  const t = text.trim();
  try {
    const o = JSON.parse(t);
    if (o && typeof o === 'object') {
      if (o.v === 2 && typeof o.enc === 'string') return true; // whole bundle encrypted
      if (typeof o.key === 'string') return backupKind(o.key) === 'encrypted';
    }
  } catch { /* not JSON → bare key */ }
  return backupKind(t) === 'encrypted';
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
