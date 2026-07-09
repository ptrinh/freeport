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

export interface Coords { latitude: number; longitude: number }

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

/** Show a native OS notification. Requests permission on first use. */
export async function nativeNotify(title: string, body: string): Promise<boolean> {
  const invoke = inv();
  if (!invoke) return false;
  try {
    let granted = await nativeNotificationGranted();
    if (!granted) granted = await nativeRequestNotification();
    if (!granted) return false;
    await invoke('plugin:notification|notify', { options: { title, body } });
    return true;
  } catch { return false; }
}

// ── Native geolocation (tauri-plugin-geolocation; mobile-first, desktop may
//    report unsupported → callers fall back to IP) ──────────────────────────

async function geoPermitted(invoke: Invoke, request: boolean): Promise<boolean> {
  try {
    let s = await invoke('plugin:geolocation|check_permissions');
    let state = s?.location ?? s?.coarseLocation;
    if (state !== 'granted' && request) {
      s = await invoke('plugin:geolocation|request_permissions', { permissions: ['location'] });
      state = s?.location ?? s?.coarseLocation;
    }
    return state === 'granted';
  } catch { return false; }
}

export async function nativeGeoGranted(): Promise<boolean> {
  const invoke = inv();
  if (!invoke) return false;
  return geoPermitted(invoke, false);
}

export async function nativeRequestGeo(): Promise<boolean> {
  const invoke = inv();
  if (!invoke) return false;
  return geoPermitted(invoke, true);
}

export async function nativeGeolocation(): Promise<Coords | null> {
  const invoke = inv();
  if (!invoke) return null;
  try {
    if (!(await geoPermitted(invoke, true))) return null;
    const pos = await invoke('plugin:geolocation|get_current_position', { options: {} });
    const c = pos?.coords;
    return c && typeof c.latitude === 'number' ? { latitude: c.latitude, longitude: c.longitude } : null;
  } catch { return null; }
}
