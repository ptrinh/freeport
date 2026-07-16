/* eslint-disable @typescript-eslint/no-explicit-any -- Tauri IPC bridge globals are untyped */
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

// ── External links (tauri-plugin-opener) ──────────────────────────────────────

/** Open a URL in the system browser / default app (tel:, mailto:, https:).
 *  The Tauri WebView silently drops window.open() to external origins, which is
 *  what react-native-web's Linking.openURL does — so on desktop we route
 *  through the opener plugin instead. */
export async function openExternal(url: string): Promise<boolean> {
  const invoke = inv();
  if (!invoke) return false;
  try { await invoke('plugin:opener|open_url', { url }); return true; } catch { return false; }
}

/** Monkey-patch Linking.openURL to use the system opener when running in the
 *  desktop shell. No-op elsewhere. Call once at startup. */
export function installDesktopLinkOpener(linking: { openURL: (url: string) => Promise<any> }): void {
  if (!isTauri()) return;
  linking.openURL = (url: string) => openExternal(url) as Promise<any>;
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

// Deep-link target of the most recent notification shown while the window was
// unfocused — consumed by the focus fallback in onNativeNotificationTap.
let lastUnfocusedNotify: { tab: string; at: number } | null = null;

/** Show a native OS notification. Requests permission on first use. `tab` is
 *  carried in `extra` so a tap can deep-link (see onNativeNotificationTap). */
export async function nativeNotify(title: string, body: string, tab?: string): Promise<boolean> {
  const invoke = inv();
  if (!invoke) return false;
  try {
    let granted = await nativeNotificationGranted();
    if (!granted) granted = await nativeRequestNotification();
    if (!granted) return false;
    if (tab && typeof document !== 'undefined' && !document.hasFocus()) {
      lastUnfocusedNotify = { tab, at: Date.now() };
    }
    await invoke('plugin:notification|notify', { options: { title, body, extra: tab ? { tab } : undefined } });
    return true;
  } catch { return false; }
}

// How long after an unfocused notification a window-focus still counts as
// "the user tapped it". Short on purpose: past this, a focus is far more
// likely the user just returning to the app on their own.
const TAP_FOCUS_WINDOW_MS = 2 * 60_000;

/** Route native-notification taps to a callback with the carried `tab`.
 *
 *  Two mechanisms, because tauri-plugin-notification's onAction only fires on
 *  mobile — desktop OSes don't deliver body-tap events to the plugin:
 *  1. onAction — authoritative where available.
 *  2. Focus fallback — tapping a macOS notification activates the app, so a
 *     window-focus arriving shortly after a notification that was shown while
 *     the window was UNFOCUSED is treated as a tap on it. May rarely fire when
 *     the user returns via the Dock instead, but only within the window and
 *     only when there genuinely is fresh activity to show. */
export function onNativeNotificationTap(cb: (tab?: string) => void): () => void {
  if (!isTauri()) return () => {};
  let unlisten: (() => void) | undefined;
  let cancelled = false;
  (async () => {
    try {
      const mod: any = await import('@tauri-apps/plugin-notification');
      const un = await mod.onAction((n: any) => {
        lastUnfocusedNotify = null; // authoritative — don't double-fire via focus
        cb(n?.extra?.tab ?? n?.notification?.extra?.tab);
      });
      if (cancelled) un(); else unlisten = un;
    } catch { /* plugin/action API unavailable on this platform */ }
  })();
  const onFocus = () => {
    const last = lastUnfocusedNotify;
    if (!last) return;
    lastUnfocusedNotify = null;
    if (Date.now() - last.at <= TAP_FOCUS_WINDOW_MS) cb(last.tab);
  };
  if (typeof window !== 'undefined') window.addEventListener('focus', onFocus);
  return () => {
    cancelled = true;
    try { unlisten?.(); } catch { /* ignore */ }
    if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus);
  };
}
