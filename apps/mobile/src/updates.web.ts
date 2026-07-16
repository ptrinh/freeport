/**
 * Web has no OTA concept — the browser fetches the newest deploy on every load.
 * "Check for updates" just hard-reloads the page (and re-registers the SW so a
 * waiting service worker activates). Kept API-compatible with updates.ts.
 *
 * DESKTOP (Tauri shell): the web bundle is baked into the binary, so a reload
 * changes nothing. There, "Check now" is a real self-update via
 * tauri-plugin-updater: it checks the GitHub Releases latest.json (minisign-
 * verified), and applyUpdate() downloads + installs + relaunches.
 */
import Constants from 'expo-constants';
import { isTauri } from './desktopNative';

// The desktop shell's own version (from tauri.conf.json — may be ahead of the
// embedded web bundle's version). Fetched once; versionLabel stays sync.
let desktopVersion: string | null = null;
if (isTauri()) {
  try {
    (globalThis as { __TAURI__?: { app?: { getVersion?: () => Promise<string> } } }).__TAURI__?.app?.getVersion?.()
      .then((v: string) => { desktopVersion = v; })
      .catch(() => {});
  } catch { /* ignore */ }
}

// The update found by the last checkForUpdate(), consumed by applyUpdate().
let pendingDesktopUpdate: { downloadAndInstall: () => Promise<void> } | null = null;

export type UpdateOutcome = 'updated' | 'up-to-date' | 'unsupported' | 'error';
export interface UpdateResult { outcome: UpdateOutcome; message?: string }

// Web has no OTA channels — the browser always serves the newest deploy.
export type UpdateTrack = 'latest' | 'stable';
export function trackSupported(): boolean { return false; }
export async function getTrack(): Promise<UpdateTrack> { return 'latest'; }
export function applyTrack(_track: UpdateTrack): void { /* no-op on web */ }
export async function setTrack(_track: UpdateTrack): Promise<UpdateResult> { return { outcome: 'up-to-date' }; }

export function versionLabel(): string {
  if (isTauri()) return `v${desktopVersion ?? Constants.expoConfig?.version ?? '—'} · desktop`;
  return `v${Constants.expoConfig?.version ?? '—'} · web`;
}

// Web reloads instantly to the newest deploy — there's no background "updating" state.
export function useUpdateState(): { updating: boolean } {
  return { updating: false };
}

export async function checkForUpdate(): Promise<UpdateResult> {
  if (isTauri()) {
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (!update) return { outcome: 'up-to-date' };
      pendingDesktopUpdate = update;
      return { outcome: 'updated' };
    } catch (e) {
      // Linux .deb installs have no updater backend (AppImage-only) — surface
      // as unsupported-ish error rather than pretending we checked.
      return { outcome: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }
  // Nothing to pre-download on web; the reload itself fetches the new build.
  return { outcome: 'updated' };
}

export async function applyUpdate(): Promise<void> {
  if (isTauri()) {
    const upd = pendingDesktopUpdate;
    pendingDesktopUpdate = null;
    if (!upd) return;
    await upd.downloadAndInstall();
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
    return;
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.location.reload();
}

/** Reload the app to apply a layout-direction / RTL change. */
export async function reloadApp(): Promise<void> {
  if (typeof window !== 'undefined') window.location.reload();
}
