/**
 * Web has no OTA concept — the browser fetches the newest deploy on every load.
 * "Check for updates" just hard-reloads the page (and re-registers the SW so a
 * waiting service worker activates). Kept API-compatible with updates.ts.
 */
import Constants from 'expo-constants';

export type UpdateOutcome = 'updated' | 'up-to-date' | 'unsupported' | 'error';
export interface UpdateResult { outcome: UpdateOutcome; message?: string }

// Web has no OTA channels — the browser always serves the newest deploy.
export type UpdateTrack = 'latest' | 'stable';
export function trackSupported(): boolean { return false; }
export async function getTrack(): Promise<UpdateTrack> { return 'latest'; }
export function applyTrack(_track: UpdateTrack): void { /* no-op on web */ }
export async function setTrack(_track: UpdateTrack): Promise<UpdateResult> { return { outcome: 'up-to-date' }; }

export function versionLabel(): string {
  return `v${Constants.expoConfig?.version ?? '—'} · web`;
}

// Web reloads instantly to the newest deploy — there's no background "updating" state.
export function useUpdateState(): { updating: boolean } {
  return { updating: false };
}

export async function checkForUpdate(): Promise<UpdateResult> {
  // Nothing to pre-download on web; the reload itself fetches the new build.
  return { outcome: 'updated' };
}

export async function applyUpdate(): Promise<void> {
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
