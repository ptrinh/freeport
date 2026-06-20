/**
 * Over-the-air updates (native) via expo-updates / EAS Update.
 *
 * The native shell is built once; JS+asset bundles are then swapped OTA — no
 * App Store / EAS Build round-trip for JS-only changes. Each build is pinned to
 * a runtimeVersion (app.json `runtimeVersion.policy = appVersion`); an update
 * only lands on builds with a matching runtime, so a native change just needs a
 * version bump + one rebuild.
 *
 * `web` uses updates.web.ts (a plain page reload — the browser already fetches
 * the newest deploy on load).
 */
import { Platform } from 'react-native';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import * as Application from 'expo-application';

/**
 * Live "is an OTA update being fetched right now" flag, for the header status.
 * True while expo-updates is checking the server or downloading a new bundle.
 */
export function useUpdateState(): { updating: boolean } {
  const { isChecking, isDownloading } = Updates.useUpdates();
  return { updating: !!(isChecking || isDownloading) };
}

export type UpdateOutcome =
  | 'updated'        // new bundle fetched → caller should reloadAsync()
  | 'up-to-date'     // already on the newest bundle
  | 'unsupported'    // OTA disabled (dev client / Expo Go / not built with updates)
  | 'error';

export interface UpdateResult { outcome: UpdateOutcome; message?: string }

/** Human label for the running build, e.g. "v1.0.0 · OTA a1b2c3d". */
export function versionLabel(): string {
  const v = Constants.expoConfig?.version ?? '—';
  // True binary build number from expo-application (CFBundleVersion / versionCode).
  // We deliberately do NOT fall back to the app-config value: that rides in over
  // OTA and would read "build 2" on an old binary too, hiding the very thing this
  // is for. So a "—" here means the running binary predates expo-application
  // (i.e. an older build), which is itself the useful diagnostic.
  let build: string | null = null;
  try { build = Application.nativeBuildVersion ?? null; } catch { /* not available */ }
  const id = Updates.isEmbeddedLaunch ? null : (Updates.updateId ?? null);
  const buildStr = Platform.OS === 'web' ? '' : ` (build ${build ?? '—'})`;
  return `v${v}${buildStr}${id ? ` · OTA ${id.slice(0, 7)}` : ''}`;
}

/** Check the update server, download a newer bundle if any. Does NOT reload. */
export async function checkForUpdate(): Promise<UpdateResult> {
  if (!Updates.isEnabled) return { outcome: 'unsupported' };
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return { outcome: 'up-to-date' };
    const fetched = await Updates.fetchUpdateAsync();
    return fetched.isNew ? { outcome: 'updated' } : { outcome: 'up-to-date' };
  } catch (e: any) {
    return { outcome: 'error', message: e?.message };
  }
}

/** Restart into the freshly-downloaded bundle. */
export async function applyUpdate(): Promise<void> {
  await Updates.reloadAsync();
}
