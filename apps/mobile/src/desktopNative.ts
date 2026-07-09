/**
 * Bridge to Tauri desktop plugins (notification + geolocation) via the
 * `window.__TAURI__` global — NO @tauri-apps imports, so the web/native RN
 * bundles are unaffected and isTauri() is simply false there. Every call is
 * best-effort: failures resolve to a safe default (no throw), because these
 * plugins may be unavailable/unsupported on a given desktop platform.
 */
type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<any>;

function inv(): Invoke | null {
  const g = (globalThis as any).__TAURI__;
  return g && g.core && typeof g.core.invoke === 'function' ? (g.core.invoke as Invoke) : null;
}

export function isTauri(): boolean {
  return inv() != null;
}

// ── Native notifications (tauri-plugin-notification) ──────────────────────────

export async function nativeNotificationGranted(): Promise<boolean> {
  const invoke = inv();
  if (!invoke) return false;
  try { return !!(await invoke('plugin:notification|is_permission_granted')); } catch { return false; }
}

export async function nativeRequestNotification(): Promise<boolean> {
  const invoke = inv();
  if (!invoke) return false;
  try { return (await invoke('plugin:notification|request_permission')) === 'granted'; } catch { return false; }
}

/** Show a native OS notification. Requests permission on first use. `tab` is
 *  carried in `extra` so a tap can deep-link (see onNativeNotificationTap). */
export async function nativeNotify(title: string, body: string, tab?: string): Promise<boolean> {
  const invoke = inv();
  if (!invoke) return false;
  try {
    let granted = await nativeNotificationGranted();
    if (!granted) granted = await nativeRequestNotification();
    if (!granted) return false;
    await invoke('plugin:notification|notify', { options: { title, body, extra: tab ? { tab } : undefined } });
    return true;
  } catch { return false; }
}

/** Route native-notification taps to a callback with the carried `tab`. Uses
 *  the plugin's onAction (fires on tap/action). Best-effort: desktop body-tap
 *  delivery varies by OS; returns a no-op unsubscribe if unavailable. */
export function onNativeNotificationTap(cb: (tab?: string) => void): () => void {
  if (!isTauri()) return () => {};
  let unlisten: (() => void) | undefined;
  let cancelled = false;
  (async () => {
    try {
      const mod: any = await import('@tauri-apps/plugin-notification');
      const un = await mod.onAction((n: any) => {
        cb(n?.extra?.tab ?? n?.notification?.extra?.tab);
      });
      if (cancelled) un(); else unlisten = un;
    } catch { /* plugin/action API unavailable on this platform */ }
  })();
  return () => { cancelled = true; try { unlisten?.(); } catch { /* ignore */ } };
}
