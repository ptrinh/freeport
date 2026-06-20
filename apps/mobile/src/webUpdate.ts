/**
 * Native has no "newer web deploy" concept — OTA is handled by expo-updates
 * (see updates.ts + Settings → Check for updates). No-op so App.tsx can call the
 * same hook unconditionally; the web variant (webUpdate.web.ts) does the work.
 */
export function useWebUpdateAvailable(): { available: boolean; apply: () => void } {
  return { available: false, apply: () => {} };
}
