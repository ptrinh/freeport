/**
 * Keep the cloud backup (iCloud Keychain / Google Block Store) continuously in
 * sync: whenever the user changes a backed-up thing (profile, prefs, saved
 * addresses), the persistence layer calls scheduleCloudSync(), which debounces
 * and re-saves the full bundle. No-op when cloud isn't available (web / a binary
 * without the native module) or before an identity exists.
 *
 * `./backup` is imported dynamically inside the timer so this module can be
 * imported by prefs/profile/addressbook without a static import cycle (backup.ts
 * itself imports those modules to build the bundle).
 */
import { cloudAvailable, cloudSave } from './cloudBackup';
import { loadKey } from './identity';

let timer: ReturnType<typeof setTimeout> | null = null;

export function scheduleCloudSync(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    try {
      const sk = await loadKey();
      if (!sk) return; // no identity yet
      if (cloudAvailable()) {
        const { buildCloudBundle } = await import('./backup');
        await cloudSave(await buildCloudBundle(sk));
      }
      // Relay copy (encrypted to self) — this is what a passkey sign-in on a
      // brand-new device restores from; the OS cloud is per-platform.
      const { publishSettingsSync } = await import('./relaySync');
      await publishSettingsSync(sk);
    } catch { /* best-effort; manual backup + file backup remain */ }
  }, 1500);
}
