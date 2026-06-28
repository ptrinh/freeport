/**
 * iOS background-task keep-alive (local Expo module `FreeportBackgroundTask`).
 *
 * `beginBackgroundTask()` asks iOS for the ~30s extended-background window via
 * UIKit's beginBackgroundTask, so a JS timer scheduled on backgrounding actually
 * fires (without it the app suspends in ~5s and the timer never runs).
 * `endBackgroundTask()` releases it.
 *
 * No-op on Android — there is no equivalent extended-background API (that was
 * the removed foreground service); Android relies on the time-interval local
 * notification trigger in notify.ts to survive suspend, and on push for
 * closed-app delivery. Also no-op on web (the native module is absent, so
 * requireOptionalNativeModule returns null).
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

const mod = requireOptionalNativeModule<{ begin: () => void; end: () => void }>('FreeportBackgroundTask');

export function beginBackgroundTask(): void {
  try { mod?.begin(); } catch { /* not available */ }
}

export function endBackgroundTask(): void {
  try { mod?.end(); } catch { /* not available */ }
}
