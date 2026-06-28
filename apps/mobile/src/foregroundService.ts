/**
 * Android foreground service — REMOVED.
 *
 * This used to keep a notifee foreground service alive to hold the Nostr relay
 * socket open in the background. It's now redundant: remote push (Expo/FCM, see
 * push.ts) delivers messages when the app is closed, without the
 * FOREGROUND_SERVICE_DATA_SYNC permission (which Google reviews strictly for
 * messaging use). Kept as no-ops so any remaining callers compile.
 */
export async function startBackgroundService(): Promise<void> {
  /* no-op — replaced by push notifications */
}

export async function stopBackgroundService(): Promise<void> {
  /* no-op — replaced by push notifications */
}
