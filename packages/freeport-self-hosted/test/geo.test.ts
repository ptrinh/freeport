import { describe, it, expect } from 'vitest';
import { geohashesCovering, distanceKmToGeohash } from '../src/geo.js';
import { geohashEncode, geohashPrefixes } from '@freeport/protocol';

// Singapore CBD
const LAT = 1.284;
const LON = 103.851;

describe('geohashesCovering', () => {
  it('uses a coarse precision for a large radius (not thousands of fine cells)', () => {
    const cover = geohashesCovering(LAT, LON, 100);
    expect(cover.length).toBeLessThanOrEqual(64);
    // 100 km radius must not be covered at precision 6 (~0.6 km cells).
    expect(cover.every((g) => g.length <= 4)).toBe(true);
  });

  it('always contains the centre cell', () => {
    for (const radius of [0.1, 1, 5, 25, 100, 500]) {
      const cover = geohashesCovering(LAT, LON, radius);
      const p = cover[0].length;
      expect(cover).toContain(geohashEncode(LAT, LON, p));
    }
  });

  it('covers points near the circle edge in every direction', () => {
    const radius = 50;
    const cover = new Set(geohashesCovering(LAT, LON, radius));
    const p = [...cover][0].length;
    const dLat = (radius * 0.9) / 111;
    const dLon = (radius * 0.9) / (111 * Math.cos((LAT * Math.PI) / 180));
    // N, S, E, W points at 90% of the radius must fall in covered cells.
    for (const [la, lo] of [
      [LAT + dLat, LON],
      [LAT - dLat, LON],
      [LAT, LON + dLon],
      [LAT, LON - dLon],
    ]) {
      expect(cover.has(geohashEncode(la, lo, p))).toBe(true);
    }
  });

  it('matches intents tagged with geohashPrefixes at any radius', () => {
    // An intent posted at a precise location carries prefix tags 1..6; every
    // radius cover (whatever precision it picks) must intersect them when the
    // intent lies inside the circle (here: at half the radius, due north).
    for (const radius of [1, 5, 25, 100]) {
      const intentLat = LAT + (radius * 0.5) / 111;
      const tags = new Set(geohashPrefixes(geohashEncode(intentLat, LON, 10)));
      const cover = geohashesCovering(LAT, LON, radius);
      expect(cover.some((g) => tags.has(g))).toBe(true);
    }
  });

  it('respects the cap even for a pathological radius', () => {
    expect(geohashesCovering(LAT, LON, 20000).length).toBeLessThanOrEqual(64);
  });
});

describe('distanceKmToGeohash', () => {
  it('returns ~0 for the same point and null for junk', () => {
    expect(distanceKmToGeohash(LAT, LON, geohashEncode(LAT, LON, 7))!).toBeLessThan(0.2);
    expect(distanceKmToGeohash(LAT, LON, 'not-a-geohash!')).toBeNull();
  });
});
