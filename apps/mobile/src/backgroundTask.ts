/**
 * iOS background-task keep-alive (local Expo module `FreeportBackgroundTask`).
 *
 * `beginBackgroundTask()` asks iOS for the ~30s extended-background window via
 * UIKit's beginBackgroundTask, so a JS timer scheduled on backgrounding actually
 * fires (without it the app suspends in ~5s and the timer never runs).
 * `endBackgroundTask()` releases it.
 *
 * No-op on Android (uses a foreground service) and web (the native module is
 * absent, so requireOptionalNativeModule returns null).
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

const mod = requireOptionalNativeModule<{ begin: () => void; end: () => void }>('FreeportBackgroundTask');

export function beginBackgroundTask(): void {
  try { mod?.begin(); } catch { /* not available */ }
}

export function endBackgroundTask(): void {
  try { mod?.end(); } catch { /* not available */ }
}
