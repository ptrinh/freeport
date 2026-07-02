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
import { kvGet, kvSet } from './kv';

// ── Update track ("which release to follow") ────────────────────────────────
// Two EAS channels: `production` = Latest (newest), `stable` = one release
// behind. A user can pick either; we override the channel at runtime (needs
// `updates.disableAntiBrickingMeasures` in app.json — present from app v0.2.0).
const UPDATE_URL = 'https://u.expo.dev/1c014d95-0907-4e4c-a65a-8beedf0fc805';
export type UpdateTrack = 'latest' | 'stable';
const TRACK_CHANNEL: Record<UpdateTrack, string> = { latest: 'production', stable: 'stable' };
const TRACK_KEY = 'freeport.updateTrack';

/** OTA tracks are only switchable on native builds that ship the override flag,
 *  which first lands in the 0.2.0 binary. Gate on the native binary version
 *  (NOT OTA-overridable) so this code can ride a 0.1.0 OTA to current users
 *  without surfacing a dead toggle on builds that lack the flag. */
export function trackSupported(): boolean {
  if (Platform.OS === 'web' || !Updates.isEnabled) return false;
  const v = Application.nativeApplicationVersion ?? '0.0.0';
  const [a = 0, b = 0] = v.split('.').map((n) => parseInt(n, 10) || 0);
  return a > 0 || (a === 0 && b >= 2); // >= 0.2.0
}

/** The track the user has chosen (defaults to Latest). */
export async function getTrack(): Promise<UpdateTrack> {
  return (await kvGet(TRACK_KEY)) === 'stable' ? 'stable' : 'latest';
}

/** Point OTA at the chosen track's channel. Safe to call on every launch; a
 *  no-op on web or on builds without the anti-bricking flag. */
export function applyTrack(track: UpdateTrack): void {
  if (!trackSupported()) return;
  try {
    Updates.setUpdateURLAndRequestHeadersOverride({
      updateUrl: UPDATE_URL,
      requestHeaders: { 'expo-channel-name': TRACK_CHANNEL[track] },
    });
  } catch { /* flag absent on this build — leave the baked channel in place */ }
}

/** Persist + apply a track, then fetch that track's head (caller reloads on 'updated'). */
export async function setTrack(track: UpdateTrack): Promise<UpdateResult> {
  await kvSet(TRACK_KEY, track).catch(() => {});
  applyTrack(track);
  return checkForUpdate();
}

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

/** Reload the app (used to apply a layout-direction / RTL change on native,
 *  which I18nManager.forceRTL only takes effect after a restart). */
export async function reloadApp(): Promise<void> {
  try {
    if (Updates.isEnabled) { await Updates.reloadAsync(); return; }
  } catch { /* fall through */ }
  // Dev / no-updates build: nudge the user, since we can't self-restart.
  // (Callers surface a "restart to apply" message when this returns.)
}
