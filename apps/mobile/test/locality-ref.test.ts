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

const NAMES: Record<string, string> = { TH: 'Thailand', MY: 'Malaysia' };
const countryName = (c: string) => NAMES[c] ?? c;

beforeEach(() => _resetLocalityCache());

describe('locQuery', () => {
  it('builds "city, state, country" and skips blanks', () => {
    expect(locQuery({ country: 'TH', state: 'Bangkok', city: 'Bangkok' }, countryName)).toBe('Bangkok, Bangkok, Thailand');
    expect(locQuery({ country: 'MY' }, countryName)).toBe('Malaysia');
  });

  it('is empty when no location is selected (feed never held)', () => {
    expect(locQuery({}, countryName)).toBe('');
    expect(locRefSeed('').settled).toBe(true);
  });

  it('"Other" (XX) has nothing to geocode — behaves like no location', () => {
    expect(locQuery({ country: 'XX' }, countryName)).toBe('');
  });
});

describe('cold start (the reported flicker)', () => {
  it('holds the feed until the geocode resolves — never renders unfiltered', () => {
    const q = locQuery({ country: 'TH', city: 'Bangkok' }, countryName);
    // Mount: nothing cached yet → settled=false → feed held, NOT unfiltered.
    expect(locRefSeed(q)).toEqual({ gh: null, settled: false });
    // Geocode resolves → effect stores it → feed renders filtered.
    locRefStore(q, 'w4rqnb2v');
    expect(locRefSeed(q)).toEqual({ gh: 'w4rqnb2v', settled: true });
  });

  it('a failed geocode still settles (feed shows, unfiltered by design)', () => {
    const q = 'Nowhereville, Thailand';
    locRefStore(q, null); // geohashForPlace found nothing
    expect(locRefSeed(q)).toEqual({ gh: null, settled: true });
  });
});

describe('tab switch away and back (remount)', () => {
  it('re-renders instantly from the seed — no loading state, no flicker', () => {
    const q = locQuery({ country: 'TH', city: 'Bangkok' }, countryName);
    // First visit resolves and stores.
    locRefStore(q, 'w4rqnb2v');
    // Leave Browse (unmount), come back (remount): seeded and settled at once.
    const remount = locRefSeed(q);
    expect(remount).toEqual({ gh: 'w4rqnb2v', settled: true });
    // The resolve effect refreshes silently: cache hit → it must NOT unsettle.
    expect(locRefHas(q)).toBe(true);
  });
});

describe('user changes location in Settings, then returns to Browse', () => {
  it('holds the feed for the NEW location until its geocode resolves', () => {
    const bkk = locQuery({ country: 'TH', city: 'Bangkok' }, countryName);
    locRefStore(bkk, 'w4rqnb2v'); // resolved during the first Browse visit

    // Settings: location → Malaysia. Back to Browse: the old ref must NOT
    // leak (posts would be filtered against the wrong place) and the feed is
    // held until Malaysia resolves.
    const kl = locQuery({ country: 'MY' }, countryName);
    expect(locRefSeed(kl)).toEqual({ gh: null, settled: false });
    expect(locRefHas(kl)).toBe(false); // effect must re-resolve, not refresh silently

    locRefStore(kl, 'w2827h7q');
    expect(locRefSeed(kl)).toEqual({ gh: 'w2827h7q', settled: true });

    // Switching back to Bangkok later re-seeds… the cache is last-write, so it
    // resolves again (held again) rather than serving Malaysia's point.
    expect(locRefSeed(bkk)).toEqual({ gh: null, settled: false });
  });
});

describe('device point (GPS/IP) across remounts', () => {
  it('seeds the last device geohash so remounts render distance-filtered immediately', () => {
    expect(userGeohashSeed()).toBeNull(); // cold start: nothing yet
    userGeohashStore('w2827h7q');
    expect(userGeohashSeed()).toBe('w2827h7q'); // remount: instant
  });
});
