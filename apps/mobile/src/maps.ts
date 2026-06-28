/**
 * Maps & geocoding helpers.
 *
 * - Google Maps deep links need no API key: route by place names, place by
 *   name or coordinates.
 * - Geocoding uses the platform geocoder via expo-location (Apple on iOS,
 *   Google on Android) — also key-free. Typed location names become real
 *   coordinates → geohash at post time, so market filtering and maps work
 *   on actual positions instead of a hardcoded demo geohash.
 */
import { geohashEncode, geohashDecode } from '@freeport/protocol';
import { getCurrentCoords as geoCurrent, forwardGeocode, locationGranted, requestLocationPermission, reverseGeocodeLine, reverseGeocodeRaw, suggest } from './geo';
export { suggest };
export type { Suggestion } from './geo';
import { getI18nLang } from './i18n';

// Re-export so existing imports from './maps' keep working across platforms.
export const getCurrentCoords = geoCurrent;
export { forwardGeocode, locationGranted, requestLocationPermission };

export function routeUrl(from: string, to: string): string {
  return (
    'https://www.google.com/maps/dir/?api=1' +
    `&origin=${encodeURIComponent(from)}` +
    `&destination=${encodeURIComponent(to)}` +
    '&travelmode=driving'
  );
}

/**
 * Turn-by-turn navigation link to a single destination. Origin is omitted so
 * Google Maps starts from the user's *current* location — what a driver heading
 * to a pickup, or a provider heading to a job, actually wants.
 */
export function dirUrl(dest: string): string {
  return (
    'https://www.google.com/maps/dir/?api=1' +
    `&destination=${encodeURIComponent(dest)}` +
    '&travelmode=driving'
  );
}

/**
 * A Google-Maps place param from a geohash: precise "lat,lon" when the geohash
 * decodes (i.e. the user pinned a real point), else the human label as fallback.
 */
export function placeParam(geohash: string | undefined, fallbackName: string): string {
  if (geohash) {
    const c = geohashToCoords(geohash);
    if (c) return `${c.latitude},${c.longitude}`;
  }
  return fallbackName;
}

export function placeUrl(name: string, geohash?: string): string {
  if (name.trim()) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
  }
  if (geohash) {
    try {
      const { lat, lon } = geohashDecode(geohash);
      return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
    } catch {}
  }
  return 'https://www.google.com/maps';
}

/**
 * Geocode a typed place name to a 6-char geohash (±0.6km). Falls back to the
 * given default if the geocoder finds nothing (offline, gibberish input…).
 */
export async function geohashForPlace(name: string, fallback: string): Promise<string> {
  const c = await forwardGeocode(name);
  return c ? geohashEncode(c.latitude, c.longitude, 10) : fallback;
}

/**
 * Decode a geohash to a MapView-friendly center, or null if invalid.
 *
 * Memoized: Browse decodes the same geohashes thousands of times (filter +
 * O(n log n) sort + render, re-run on every keystroke / 30s tick). A geohash's
 * coordinates never change, so each distinct geohash is decoded once per session.
 */
const coordsCache = new Map<string, { latitude: number; longitude: number } | null>();
export function geohashToCoords(geohash: string): { latitude: number; longitude: number } | null {
  const hit = coordsCache.get(geohash);
  if (hit !== undefined) return hit;
  let v: { latitude: number; longitude: number } | null;
  try {
    const { lat, lon } = geohashDecode(geohash);
    v = { latitude: lat, longitude: lon };
  } catch {
    v = null;
  }
  if (coordsCache.size >= 100000) coordsCache.clear(); // bound memory (huge headroom)
  coordsCache.set(geohash, v);
  return v;
}

// Countries that use miles for road distance (US, UK, Liberia, Myanmar).
const MILE_COUNTRIES = new Set(['US', 'GB', 'LR', 'MM']);

/** Whether to show road distance in miles for the given ISO country code. */
export function usesMiles(countryCode?: string): boolean {
  return !!countryCode && MILE_COUNTRIES.has(countryCode.toUpperCase());
}

/** Human distance label, localized: "14,5 km" / "9 mi". The unit is the user's
 *  explicit choice (`'km'`/`'mi'`) when given, else country-derived. */
export function formatDistance(km: number, countryCode?: string, unit?: 'km' | 'mi'): string {
  const mile = unit ? unit === 'mi' : usesMiles(countryCode);
  const value = mile ? km * 0.621371 : km;
  const maximumFractionDigits = value < 10 ? 1 : 0;
  try {
    return new Intl.NumberFormat(getI18nLang(), {
      style: 'unit', unit: mile ? 'mile' : 'kilometer', unitDisplay: 'short', maximumFractionDigits,
    }).format(value);
  } catch {
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${mile ? 'mi' : 'km'}`;
  }
}

/** Great-circle distance in km between two geohashes, or null if either is invalid. */
export function distanceKmBetweenGeohashes(a: string, b: string): number | null {
  const ca = geohashToCoords(a);
  const cb = geohashToCoords(b);
  if (!ca || !cb) return null;
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(cb.latitude - ca.latitude);
  const dLon = toRad(cb.longitude - ca.longitude);
  const lat1 = toRad(ca.latitude);
  const lat2 = toRad(cb.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Encode picked map coordinates to a high-precision 10-char geohash (~±0.6m) so
 * navigation goes to the EXACT pin, not a fuzzy cell centre. Relay `#g` filtering
 * uses only a coarse 5-char PREFIX of this (see `geohashes: [gh.slice(0, 5)]` at
 * post time), so the higher precision here doesn't change location bucketing.
 */
export function coordsToGeohash(latitude: number, longitude: number): string {
  return geohashEncode(latitude, longitude, 10);
}

export interface RawLocation { countryCode?: string; region?: string; city?: string }

/** Detect coarse location from device GPS (reverse-geocoded). Null if denied. */
export async function detectRawLocationGPS(): Promise<RawLocation | null> {
  const coords = await getCurrentCoords();
  if (!coords) return null;
  return reverseGeocodeRaw(coords.latitude, coords.longitude);
}

interface IpInfo { countryCode?: string; region?: string; city?: string; latitude?: number; longitude?: number }

// One IP geolocation per session, cached. ipapi.co alone is unreliable (free
// tier rate-limits and returns {error:true} instead of a country), which left
// the country empty when GPS was off — so try ipwho.is first (more generous,
// CORS-friendly), then ipapi.co. Only a successful lookup is cached, so a
// transient failure still retries on the next call.
let ipCache: IpInfo | null = null;
async function ipLookup(): Promise<IpInfo | null> {
  if (ipCache) return ipCache;
  const providers: { url: string; map: (d: any) => IpInfo | null }[] = [
    { url: 'https://ipwho.is/', map: (d) => (d && d.success !== false && d.country_code)
        ? { countryCode: d.country_code, region: d.region, city: d.city, latitude: d.latitude, longitude: d.longitude } : null },
    { url: 'https://ipapi.co/json/', map: (d) => (d && !d.error && typeof d.country_code === 'string')
        ? { countryCode: d.country_code, region: d.region, city: d.city, latitude: d.latitude, longitude: d.longitude } : null },
  ];
  for (const p of providers) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(p.url, { signal: ctrl.signal });
      clearTimeout(t);
      const info = p.map(await res.json());
      if (info?.countryCode) { ipCache = info; return info; }
    } catch { /* try next provider */ }
  }
  return null;
}

/** Detect coarse location from IP, best-effort across providers. */
export async function detectRawLocationIP(): Promise<RawLocation | null> {
  const m = await ipLookup();
  return m?.countryCode ? { countryCode: m.countryCode, region: m.region, city: m.city } : null;
}

/** Detect approximate coordinates from IP — the GPS fallback for the proximity
 * geohash when device location is denied/unavailable. ~city accuracy. */
export async function detectCoordsIP(): Promise<{ latitude: number; longitude: number } | null> {
  const m = await ipLookup();
  return (typeof m?.latitude === 'number' && typeof m?.longitude === 'number')
    ? { latitude: m.latitude, longitude: m.longitude } : null;
}

/** Reverse-geocode coordinates into a readable address line, or '' if none. */
export async function reverseGeocode(latitude: number, longitude: number): Promise<string> {
  return reverseGeocodeLine(latitude, longitude);
}
