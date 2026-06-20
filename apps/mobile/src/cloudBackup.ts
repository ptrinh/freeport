/**
 * Cloud backup of the Nostr identity (an `nsec`) via the local Expo module
 * `FreeportCloudBackup` — iCloud Keychain on iOS, Google Block Store on Android.
 *
 * Everything is guarded: `requireOptionalNativeModule` returns null when the
 * native module is absent (older binary / web), and every call is wrapped in
 * try/catch so a missing module never throws — `cloudAvailable()` is then false
 * and the UI falls back to the file-only flow.
 */
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

interface CloudBackupModule {
  isAvailable: () => boolean;
  save: (value: string) => Promise<void>;
  restore: () => Promise<string | null>;
  clear: () => Promise<void>;
}

const mod = requireOptionalNativeModule<CloudBackupModule>('FreeportCloudBackup');

/** True only when the native module is present and reports itself available. */
export function cloudAvailable(): boolean {
  try {
    return mod?.isAvailable?.() ?? false;
  } catch {
    return false;
  }
}

/** Store the nsec in the cloud. Returns false if no module / on error. */
export async function cloudSave(nsec: string | null): Promise<boolean> {
  if (!nsec || !mod) return false;
  try {
    await mod.save(nsec);
    return true;
  } catch {
    return false;
  }
}

/** Retrieve the stored nsec, or null if none / no module / on error. */
export async function cloudRestore(): Promise<string | null> {
  if (!mod) return null;
  try {
    return await mod.restore();
  } catch {
    return null;
  }
}

/** Remove the cloud-stored nsec. Never throws. */
export async function cloudClear(): Promise<void> {
  if (!mod) return;
  try {
    await mod.clear();
  } catch {
    /* not available */
  }
}

/** Friendly platform label for the cloud provider. */
export function cloudName(): string {
  return Platform.OS === 'ios' ? 'iCloud' : Platform.OS === 'android' ? 'Google' : '';
}
