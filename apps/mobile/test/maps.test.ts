import { describe, it, expect, vi, beforeEach } from 'vitest';

// maps.ts imports ./geo (expo-location) and ./i18n (loads all locales) at module
// top. Stub both so the pure URL/geohash helpers can be imported under Node, and
// configure the geo stubs per-test to exercise the geocoding paths too.
vi.mock('../src/geo', () => ({
  getCurrentCoords: vi.fn(),
  forwardGeocode: vi.fn(),
  locationGranted: vi.fn(),
  requestLocationPermission: vi.fn(),
  reverseGeocodeLine: vi.fn(),
  reverseGeocodeRaw: vi.fn(),
  suggest: vi.fn(),
}));
vi.mock('../src/i18n', () => ({ getI18nLang: () => 'en' }));

import * as geo from '../src/geo';
import {
  routeUrl, dirUrl, placeUrl, placeParam, appleMapsScheme,
  coordsToGeohash, geohashToCoords, geohashForPlace,
  usesMiles, formatDistance, distanceKmBetweenGeohashes,
  detectRawLocationGPS, detectRawLocationIP, detectCoordsIP, reverseGeocode,
} from '../src/maps';

beforeEach(() => vi.clearAllMocks());

describe('Google Maps URL builders', () => {
  it('routeUrl builds an api=1 directions URL with origin + destination (encoded)', () => {
    const u = routeUrl('A B', 'C D');
    expect(u).toContain('https://www.google.com/maps/dir/?api=1');
    expect(u).toContain('origin=A%20B');
    expect(u).toContain('destination=C%20D');
    expect(u).toContain('travelmode=driving');
  });
  it('dirUrl omits origin so navigation starts from current location', () => {
    const u = dirUrl('Pickup');
    expect(u).toContain('destination=Pickup');
    expect(u).not.toContain('origin=');
  });
  it('placeUrl builds a search query URL, or coords when name is blank', () => {
    expect(placeUrl('Cafe X')).toContain('search/?api=1&query=Cafe%20X');
    const gh = coordsToGeohash(1.3, 103.8);
    expect(placeUrl('', gh)).toMatch(/query=1\.\d+,103\.\d+/);
    expect(placeUrl('')).toBe('https://www.google.com/maps');
  });
});

describe('placeParam', () => {
  it('returns "lat,lon" for a decodable geohash, else the fallback name', () => {
    const gh = coordsToGeohash(1.3008, 103.8427);
    expect(placeParam(gh, 'Orchard')).toMatch(/^1\.\d+,103\.\d+$/);
    expect(placeParam(undefined, 'Orchard')).toBe('Orchard');
    expect(placeParam('!!!notarealgeohash!!!', 'Orchard')).toBe('Orchard');
  });
});

describe('appleMapsScheme (iOS PWA stuck-in-app-browser fix)', () => {
  it('rewrites a directions URL to saddr/daddr', () => {
    expect(appleMapsScheme(routeUrl('Home', 'Work'))).toBe('maps://?saddr=Home&daddr=Work&dirflg=d');
  });
  it('rewrites a destination-only URL to daddr', () => {
    expect(appleMapsScheme(dirUrl('Work'))).toBe('maps://?daddr=Work&dirflg=d');
  });
  it('rewrites a place search to a q query', () => {
    expect(appleMapsScheme(placeUrl('Cafe X'))).toBe('maps://?q=Cafe%20X');
  });
  it('returns null when there is nothing to map (falls back to https)', () => {
    expect(appleMapsScheme('https://www.google.com/maps')).toBeNull();
    expect(appleMapsScheme('not a url')).toBeNull();
  });
});

describe('coordsToGeohash (exact-pin navigation fix)', () => {
  it('encodes to a 10-char geohash that decodes back within ~1 meter', () => {
    const lat = 1.3008243600579674, lon = 103.84277143203384;
    const gh = coordsToGeohash(lat, lon);
    expect(gh).toHaveLength(10);
    const c = geohashToCoords(gh)!;
    expect(Math.abs(c.latitude - lat)).toBeLessThan(0.0001);
    expect(Math.abs(c.longitude - lon)).toBeLessThan(0.0001);
  });
  it('geohashToCoords returns null for an invalid geohash', () => {
    expect(geohashToCoords('!!!')).toBeNull();
  });
});

describe('distance helpers', () => {
  it('usesMiles is true only for mile countries', () => {
    expect(usesMiles('US')).toBe(true);
    expect(usesMiles('gb')).toBe(true);
    expect(usesMiles('VN')).toBe(false);
    expect(usesMiles(undefined)).toBe(false);
  });
  it('formatDistance renders km and mi with a unit', () => {
    expect(formatDistance(14.5, 'VN')).toMatch(/14|15/);
    expect(formatDistance(10, 'US')).toMatch(/mi/i);
  });
  it('distanceKmBetweenGeohashes ~ correct for far points; null on invalid', () => {
    const sg = coordsToGeohash(1.3008, 103.8427);
    const hn = coordsToGeohash(21.0278, 105.8342);
    const d = distanceKmBetweenGeohashes(sg, hn)!;
    expect(d).toBeGreaterThan(2000);
    expect(d).toBeLessThan(3500);
    expect(distanceKmBetweenGeohashes('!!!', sg)).toBeNull();
  });
});

describe('geohashForPlace', () => {
  it('geocodes a name to a 10-char geohash', async () => {
    vi.mocked(geo.forwardGeocode).mockResolvedValueOnce({ latitude: 1.3, longitude: 103.8 } as any);
    const gh = await geohashForPlace('Somewhere', 'fallback');
    expect(gh).toHaveLength(10);
  });
  it('returns the fallback when the geocoder finds nothing', async () => {
    vi.mocked(geo.forwardGeocode).mockResolvedValueOnce(null as any);
    expect(await geohashForPlace('gibberish', 'fallback-gh')).toBe('fallback-gh');
  });
});

describe('reverse / GPS / IP detection', () => {
  it('detectRawLocationGPS reverse-geocodes the device coords, null when denied', async () => {
    vi.mocked(geo.getCurrentCoords).mockResolvedValueOnce({ latitude: 1.3, longitude: 103.8 } as any);
    vi.mocked(geo.reverseGeocodeRaw).mockResolvedValueOnce({ countryCode: 'SG', city: 'SG' } as any);
    expect(await detectRawLocationGPS()).toEqual({ countryCode: 'SG', city: 'SG' });

    vi.mocked(geo.getCurrentCoords).mockResolvedValueOnce(null as any);
    expect(await detectRawLocationGPS()).toBeNull();
  });

  it('reverseGeocode delegates to the platform geocoder', async () => {
    vi.mocked(geo.reverseGeocodeLine).mockResolvedValueOnce('123 Main St');
    expect(await reverseGeocode(1.3, 103.8)).toBe('123 Main St');
  });

  it('detectRawLocationIP / detectCoordsIP read an IP lookup (cached)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ success: true, country_code: 'SG', region: 'Central', city: 'Singapore', latitude: 1.29, longitude: 103.85 }),
    })) as any);
    expect(await detectRawLocationIP()).toEqual({ countryCode: 'SG', region: 'Central', city: 'Singapore' });
    // Second call is served from the module's IP cache (same successful result).
    expect(await detectCoordsIP()).toEqual({ latitude: 1.29, longitude: 103.85 });
    vi.unstubAllGlobals();
  });
});
