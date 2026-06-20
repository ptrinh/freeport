/**
 * Web backup. Backup = download a JSON bundle (key + settings + address book)
 * via a Blob link. Restore = a hidden <input type="file"> the user picks from.
 *
 * NOTE: settings + address book are plaintext in the bundle (only the key is
 * encrypted by a passphrase). Keep the file somewhere you trust.
 */
import { backupFileContent, parseBackupBundle, type BackupExtras } from './identity';
import { loadPrefs, savePrefs, type Prefs } from './prefs';
import { loadProfile, saveProfile, type UserProfile } from './profile';
import { loadAddressBook, replaceAddressBook, type AddressBook } from './addressbook';
import { kvGet, kvSet } from './kv';

const FILE_NAME = 'freeport-backup.json';
const CREATED_KEY = 'freeport.created';
const RATED_KEY = 'freeport.rated';

async function buildBundle(sk: Uint8Array, passphrase: string): Promise<string> {
  return JSON.stringify({
    v: 1,
    app: 'freeport',
    key: backupFileContent(sk, passphrase),
    profile: await loadProfile(),  // incl. full phone (local-only) + display name
    prefs: await loadPrefs(),      // incl. location, role, theme, …
    addressBook: await loadAddressBook(),
    created: await kvGet(CREATED_KEY),
    rated: await kvGet(RATED_KEY),  // file backup has no size limit → keep ratings
  });
}

async function applyExtras(extras: BackupExtras): Promise<void> {
  const { profile, prefs, addressBook, created, rated } = extras;
  if (profile && typeof profile === 'object') await saveProfile(profile as UserProfile);
  if (prefs && typeof prefs === 'object') await savePrefs(prefs as Partial<Prefs>);
  if (addressBook && typeof addressBook === 'object') await replaceAddressBook(addressBook as AddressBook);
  if (typeof created === 'string' && created) await kvSet(CREATED_KEY, created);
  if (typeof rated === 'string' && rated) await kvSet(RATED_KEY, rated);
}

export async function backupToFile(sk: Uint8Array, passphrase: string): Promise<void> {
  const blob = new Blob([await buildBundle(sk, passphrase)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = FILE_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function restoreFromFile(passphrase: string): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.txt,application/json,text/plain';
    let handled = false;

    input.onchange = async () => {
      handled = true;
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const { sk, ...extras } = await parseBackupBundle(await file.text(), passphrase);
        await applyExtras(extras);
        resolve(sk);
      } catch (e) {
        reject(e);
      }
    };

    // The file dialog fires no "cancel" event; treat a focus return with no
    // selection as a cancel so the promise doesn't hang forever.
    const onFocus = () => {
      setTimeout(() => {
        window.removeEventListener('focus', onFocus);
        if (!handled) resolve(null);
      }, 500);
    };
    window.addEventListener('focus', onFocus);

    input.click();
  });
}
