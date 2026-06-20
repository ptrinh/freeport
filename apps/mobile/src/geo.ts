/**
 * Native geocoding/GPS via expo-location. The web build swaps in geo.web.ts
 * (browser Geolocation + OpenStreetMap Nominatim) automatically.
 */
import * as Location from 'expo-location';
import { reverseLine, reverseRaw, suggest } from './nominatim';
export type { Suggestion } from './nominatim';
export { suggest };

export interface Coords { latitude: number; longitude: number }
export interface RawPlace { countryCode?: string; region?: string; city?: string }

export async function getCurrentCoords(): Promise<Coords | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch {
    return null;
  }
}

/** Request location permission ONLY (no position fetch — that can hang on iOS
 *  with no GPS fix). Returns whether it ended up granted. */
export async function requestLocationPermission(): Promise<boolean> {
  try { return (await Location.requestForegroundPermissionsAsync()).granted; } catch { return false; }
}

/** Whether foreground location permission is already granted (no prompt). */
export async function locationGranted(): Promise<boolean> {
  try { return (await Location.getForegroundPermissionsAsync()).granted; } catch { return false; }
}

export async function forwardGeocode(name: string): Promise<Coords | null> {
  try {
    const r = (await Location.geocodeAsync(name))[0];
    return r ? { latitude: r.latitude, longitude: r.longitude } : null;
  } catch {
    return null;
  }
}

// Reverse geocoding goes through Nominatim (./nominatim), NOT expo-location:
// expo follows the device OS locale with no per-request override, so addresses
// came back in English on English-locale phones. Nominatim lets us return the
// location's local language for display, and English for DB matching.
export async function reverseGeocodeLine(latitude: number, longitude: number): Promise<string> {
  return reverseLine(latitude, longitude);
}

export async function reverseGeocodeRaw(latitude: number, longitude: number): Promise<RawPlace | null> {
  return reverseRaw(latitude, longitude);
}
