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
import { exportFirewallState, importFirewallState } from './miniapps/store';
import { isTauri } from './desktopNative';

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
    miniapps: await exportFirewallState(), // Apps-tab registry + grants
  });
}

async function applyExtras(extras: BackupExtras): Promise<void> {
  const { profile, prefs, addressBook, created, rated, miniapps } = extras;
  if (profile && typeof profile === 'object') await saveProfile(profile as UserProfile);
  if (prefs && typeof prefs === 'object') await savePrefs(prefs as Partial<Prefs>);
  if (addressBook && typeof addressBook === 'object') await replaceAddressBook(addressBook as AddressBook);
  if (typeof created === 'string' && created) await kvSet(CREATED_KEY, created);
  if (typeof rated === 'string' && rated) await kvSet(RATED_KEY, rated);
  await importFirewallState(miniapps);
}

/** Save the backup bundle. Desktop (Tauri): native save dialog — the WebView's
 *  anchor-download drops the file into Downloads with zero feedback. Web: Blob
 *  download (the browser's own download UI is the feedback). Returns the saved
 *  path on desktop (null if the user cancelled), null on web. */
export async function backupToFile(sk: Uint8Array, passphrase: string): Promise<string | null> {
  const content = await buildBundle(sk, passphrase);
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: FILE_NAME,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return null; // cancelled
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, content);
    return path;
  }
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = FILE_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return null;
}

/** Pick a backup file and return its raw text, or null on cancel — split from
 *  the restore so the UI can ask for a passphrase before attempting it. */
export async function pickBackupText(): Promise<string | null> {
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
        resolve(await file.text());
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

/**
 * Restore from backup text (key + settings + address book). Throws with a
 * friendly message for a wrong file / missing or bad passphrase.
 */
export async function restoreBackupText(text: string, passphrase: string): Promise<Uint8Array> {
  const { sk, ...extras } = await parseBackupBundle(text, passphrase);
  await applyExtras(extras);
  return sk;
}
