/**
 * Identity backup as a file (native).
 *
 * Backup: write a JSON bundle — the key (ncryptsec if a passphrase is given,
 * else plain nsec) plus device settings + address book — to a file and open
 * the system share sheet ("Save to Files" → iCloud Drive, AirDrop, email…).
 *
 * Restore: document picker → read → parse bundle (or legacy bare key) →
 * restore key + re-apply settings/address book.
 *
 * NOTE: settings and the address book are stored in plaintext in the bundle
 * (only the key is encrypted). They are low-sensitivity, but a passphrase does
 * not protect them — keep the file somewhere you trust.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { backupFileContent, parseBackupBundle, type BackupExtras } from './identity';
import { loadPrefs, savePrefs, type Prefs } from './prefs';
import { loadProfile, saveProfile, type UserProfile } from './profile';
import { loadAddressBook, replaceAddressBook, type AddressBook } from './addressbook';
import { kvGet, kvSet } from './kv';
import { exportFirewallState, importFirewallState } from './miniapps/store';

const FILE_NAME = 'freeport-backup.json';
const CREATED_KEY = 'freeport.created'; // account-age timestamp
const RATED_KEY = 'freeport.rated';     // ids of deals already rated

/** Small local flags also worth carrying across devices (account age + which
 *  deals were rated, so a restored device doesn't re-prompt rating). */
async function loadFlags(): Promise<{ created: string | null; rated: string | null }> {
  return { created: await kvGet(CREATED_KEY), rated: await kvGet(RATED_KEY) };
}

/** Bundle the key with profile + device settings + address book + local flags. */
async function buildBundle(sk: Uint8Array, passphrase: string): Promise<string> {
  const flags = await loadFlags();
  return JSON.stringify({
    v: 1,
    app: 'freeport',
    key: backupFileContent(sk, passphrase),
    profile: await loadProfile(),  // incl. full phone (local-only) + display name
    prefs: await loadPrefs(),      // incl. location, role, theme, …
    addressBook: await loadAddressBook(),
    created: flags.created,
    rated: flags.rated,
    miniapps: await exportFirewallState(), // Apps-tab registry + grants
  });
}

/** Apply the extras (profile + settings + address book + local flags) from a bundle. */
async function applyExtras(extras: BackupExtras): Promise<void> {
  const { profile, prefs, addressBook, created, rated, miniapps } = extras;
  if (profile && typeof profile === 'object') await saveProfile(profile as UserProfile);
  if (prefs && typeof prefs === 'object') await savePrefs(prefs as Partial<Prefs>);
  if (addressBook && typeof addressBook === 'object') await replaceAddressBook(addressBook as AddressBook);
  if (typeof created === 'string' && created) await kvSet(CREATED_KEY, created);
  if (typeof rated === 'string' && rated) await kvSet(RATED_KEY, rated);
  await importFirewallState(miniapps);
}

/**
 * Cloud backup bundle (iCloud Keychain / Block Store) — same shape and contents
 * as the file bundle, so restore re-applies profile (incl. picture + gallery),
 * settings and saved addresses. The images are URLs (uploaded to nostr.build),
 * not raw data, so the bundle stays small and well within cloud size limits.
 * Key is the plain nsec — the cloud store itself is encrypted by the platform
 * and tied to the user's account.
 */
export async function buildCloudBundle(sk: Uint8Array): Promise<string> {
  const flags = await loadFlags();
  return JSON.stringify({
    v: 1,
    app: 'freeport',
    key: backupFileContent(sk, ''),
    profile: await loadProfile(),
    prefs: await loadPrefs(),
    addressBook: await loadAddressBook(),
    created: flags.created,
    // `rated` and `miniapps` are intentionally omitted from the CLOUD bundle:
    // both grow without bound (rated-deal ids; the mini-app audit log) and could
    // push past the ~4KB Block Store limit. The (size-unlimited) file backup
    // carries them.
  });
}

/** Restore from a cloud bundle string (key + settings + address book + flags).
 *  Returns the secret key. Accepts the JSON bundle or a legacy bare nsec. */
export async function restoreFromBundleText(text: string): Promise<Uint8Array> {
  const { sk, ...extras } = await parseBackupBundle(text, '');
  await applyExtras(extras);
  return sk;
}

/** Write the backup file and open the share sheet. Returns the saved path when
 *  the platform can know it (desktop save dialog); null otherwise. */
export async function backupToFile(sk: Uint8Array, passphrase: string): Promise<string | null> {
  const uri = FileSystem.cacheDirectory + FILE_NAME;
  await FileSystem.writeAsStringAsync(uri, await buildBundle(sk, passphrase));
  try {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'Save your Freeport backup',
    });
  } finally {
    // Don't leave key material lying in the cache
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
  return null; // the share sheet is its own confirmation
}

/**
 * Pick a backup file and return its raw text, or null if the user cancelled.
 * Split from the restore so the UI can inspect the text (does it need a
 * passphrase?) and collect one BEFORE attempting the restore.
 */
export async function pickBackupText(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  const uri = result.assets[0].uri;
  try {
    return await FileSystem.readAsStringAsync(uri);
  } finally {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}

/**
 * Restore from backup text (key + settings + address book). Throws with a
 * friendly message for a wrong file / missing or bad passphrase.
 */
export async function restoreBackupText(text: string, passphrase: string): Promise<Uint8Array> {
  const { sk, ...extras } = await parseBackupBundle(text, passphrase);
  await applyExtras(extras);
  return sk;
}
