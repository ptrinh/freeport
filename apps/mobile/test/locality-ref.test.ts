/**
 * Regression: Browse showed far-away posts unfiltered for ~0.5s, then the
 * locality filter resolved and yanked them into "Waiting for posts…"
 * (user-reported flicker). The rules under test, as MarketTab uses them:
 *
 *  - `locRefSeed(q).settled === false` → the feed is HELD ("Finding posts
 *    near you…"), never rendered unfiltered.
 *  - `settled === true` → the feed renders immediately with the seeded ref.
 *
 * MarketTab unmounts on every tab switch, so each return to Browse replays
 * mount: `locRefSeed(locQuery(location))` seeds state, the resolve effect
 * calls `locRefStore` when the geocode finishes. These tests replay those
 * lifecycles, including the reported flows: switch away/back, and change
 * location in Settings then return to Browse.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  locQuery,
  locRefSeed,
  locRefStore,
  locRefHas,
  userGeohashSeed,
  userGeohashStore,
  _resetLocalityCache,
} from '../src/localityRef';

const NAMES: Record<string, string> = { VN: 'Vietnam', SG: 'Singapore' };
const countryName = (c: string) => NAMES[c] ?? c;

beforeEach(() => _resetLocalityCache());

describe('locQuery', () => {
  it('builds "city, state, country" and skips blanks', () => {
    expect(locQuery({ country: 'VN', state: 'Hà Nội', city: 'Hà Nội' }, countryName)).toBe('Hà Nội, Hà Nội, Vietnam');
    expect(locQuery({ country: 'SG' }, countryName)).toBe('Singapore');
  });

  it('is empty when no location is selected (feed never held)', () => {
    expect(locQuery({}, countryName)).toBe('');
    expect(locRefSeed('').settled).toBe(true);
  });
});

describe('cold start (the reported flicker)', () => {
  it('holds the feed until the geocode resolves — never renders unfiltered', () => {
    const q = locQuery({ country: 'VN', city: 'Hà Nội' }, countryName);
    // Mount: nothing cached yet → settled=false → feed held, NOT unfiltered.
    expect(locRefSeed(q)).toEqual({ gh: null, settled: false });
    // Geocode resolves → effect stores it → feed renders filtered.
    locRefStore(q, 'w7er8u2q');
    expect(locRefSeed(q)).toEqual({ gh: 'w7er8u2q', settled: true });
  });

  it('a failed geocode still settles (feed shows, unfiltered by design)', () => {
    const q = 'Nowhereville, Vietnam';
    locRefStore(q, null); // geohashForPlace found nothing
    expect(locRefSeed(q)).toEqual({ gh: null, settled: true });
  });
});

describe('tab switch away and back (remount)', () => {
  it('re-renders instantly from the seed — no loading state, no flicker', () => {
    const q = locQuery({ country: 'VN', city: 'Hà Nội' }, countryName);
    // First visit resolves and stores.
    locRefStore(q, 'w7er8u2q');
    // Leave Browse (unmount), come back (remount): seeded and settled at once.
    const remount = locRefSeed(q);
    expect(remount).toEqual({ gh: 'w7er8u2q', settled: true });
    // The resolve effect refreshes silently: cache hit → it must NOT unsettle.
    expect(locRefHas(q)).toBe(true);
  });
});

describe('user changes location in Settings, then returns to Browse', () => {
  it('holds the feed for the NEW location until its geocode resolves', () => {
    const hanoi = locQuery({ country: 'VN', city: 'Hà Nội' }, countryName);
    locRefStore(hanoi, 'w7er8u2q'); // resolved during the first Browse visit

    // Settings: location → Singapore. Back to Browse: the old ref must NOT
    // leak (posts would be filtered against the wrong place) and the feed is
    // held until Singapore resolves.
    const sg = locQuery({ country: 'SG' }, countryName);
    expect(locRefSeed(sg)).toEqual({ gh: null, settled: false });
    expect(locRefHas(sg)).toBe(false); // effect must re-resolve, not refresh silently

    locRefStore(sg, 'w21z74nz');
    expect(locRefSeed(sg)).toEqual({ gh: 'w21z74nz', settled: true });

    // Switching back to Hà Nội later re-seeds… the cache is last-write, so it
    // resolves again (held again) rather than serving Singapore's point.
    expect(locRefSeed(hanoi)).toEqual({ gh: null, settled: false });
  });
});

describe('device point (GPS/IP) across remounts', () => {
  it('seeds the last device geohash so remounts render distance-filtered immediately', () => {
    expect(userGeohashSeed()).toBeNull(); // cold start: nothing yet
    userGeohashStore('w21z74nz');
    expect(userGeohashSeed()).toBe('w21z74nz'); // remount: instant
  });
});
