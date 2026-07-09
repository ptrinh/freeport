/**
 * Web geocoding/GPS. Position from the browser Geolocation API; forward/reverse
 * geocoding + autocomplete from OpenStreetMap Nominatim (shared with native via
 * ./nominatim). Mirrors geo.ts so callers are platform-agnostic.
 */
import { forwardOne, reverseLine, reverseRaw, suggest } from './nominatim';
export type { Coords, RawPlace, Suggestion } from './nominatim';
import type { Coords } from './nominatim';

// iOS Safari's Permissions API reports geolocation as "prompt" even after the
// user has allowed it and getCurrentPosition succeeds — so permissions.query
// alone can never tell us location is granted, and the "Grant location access"
// nag would show forever. We instead remember the real outcome: set the flag
// true the moment a position actually comes back, false only on an explicit
// PERMISSION_DENIED. This is the source of truth on web; permissions.query is
// only a hint.
const GEO_OK_KEY = 'freeport.geoOk';
function setGeoFlag(ok: boolean): void {
  try { globalThis.localStorage?.setItem(GEO_OK_KEY, ok ? '1' : '0'); } catch { /* ignore */ }
}
function getGeoFlag(): boolean | null {
  try { const v = globalThis.localStorage?.getItem(GEO_OK_KEY); return v == null ? null : v === '1'; } catch { return null; }
}

// Precise geolocation needs a SECURE context (HTTPS or localhost) and a working
// Geolocation API. It is unavailable when the app is served over plain http on
// a LAN IP (self-hosted "Host Freeport for others") AND in the Tauri desktop
// WebView (WKWebView has no Geolocation API, and tauri-plugin-geolocation is
// mobile-only). In those cases callers fall back to IP-based location + the
// manual picker, and the "grant location" nag is suppressed.
function geoUnavailable(): boolean {
  const g = globalThis as any;
  return !!g.__TAURI__ || g.isSecureContext === false || !g.navigator?.geolocation;
}

export async function getCurrentCoords(): Promise<Coords | null> {
  if (geoUnavailable()) return null;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: Coords | null) => { if (!done) { done = true; resolve(v); } };
    globalThis.navigator.geolocation.getCurrentPosition(
      (pos) => { setGeoFlag(true); finish({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }); },
      (err) => { if (err && err.code === err.PERMISSION_DENIED) setGeoFlag(false); finish(null); },
      { timeout: 20000, maximumAge: 600000 },
    );
  });
}

/** Trigger the browser's geolocation permission prompt; resolve granted.
 *  Only an explicit PERMISSION_DENIED counts as not-granted — a TIMEOUT or
 *  POSITION_UNAVAILABLE means the permission is fine, there's just no fix right
 *  now (common on iOS Safari's cold GPS read). Records the real outcome so the
 *  Permissions-API "prompt" quirk can't keep the nag on screen. */
export async function requestLocationPermission(): Promise<boolean> {
  // Can't prompt in an insecure/desktop context — report "ok" so no recovery
  // alert fires (the nag is already hidden via locationGranted()).
  if (geoUnavailable()) return true;
  if (!globalThis.navigator?.geolocation) return false;
  return new Promise((resolve) => {
    globalThis.navigator.geolocation.getCurrentPosition(
      () => { setGeoFlag(true); resolve(true); },
      (err) => {
        const denied = !!(err && err.code === err.PERMISSION_DENIED);
        if (denied) setGeoFlag(false);
        resolve(!denied);
      },
      { timeout: 20000, maximumAge: 600000, enableHighAccuracy: false },
    );
  });
}

/** Whether geolocation is usable without prompting. permissions.query is
 *  authoritative only for 'granted'/'denied'; on iOS Safari it returns 'prompt'
 *  even when usable, so we fall back to our remembered outcome there. */
export async function locationGranted(): Promise<boolean> {
  if (geoUnavailable()) return true; // suppress the nag where geolocation can't work
  try {
    const p = await (globalThis.navigator as any)?.permissions?.query?.({ name: 'geolocation' });
    if (p?.state === 'granted') return true;
    if (p?.state === 'denied') return false;
    // 'prompt' (or no Permissions API): trust what actually happened before.
    return getGeoFlag() === true;
  } catch {
    return getGeoFlag() === true;
  }
}

export const forwardGeocode = forwardOne;
export const reverseGeocodeLine = reverseLine;
export const reverseGeocodeRaw = reverseRaw;
export { suggest };
