/**
 * Locality-reference cache for the Browse feed.
 *
 * MarketTab unmounts on every tab switch, so where the user "is" (the geocode
 * of their selected location + the GPS/IP geohash) would reset each time they
 * return to Browse. That caused a user-visible flicker: the feed rendered
 * UNFILTERED while the reference re-resolved, then the locality/max-distance
 * filters yanked far posts away half a second later.
 *
 * This module holds the last resolved values across remounts:
 *  - On mount, state is SEEDED from here → the feed renders already-filtered
 *    immediately; effects re-resolve silently in the background.
 *  - `settled: false` (cold start, or the user changed location) tells the
 *    feed to hold rendering ("Finding posts near you…") until the geocode
 *    finishes, instead of flashing unfiltered posts.
 */

let locRefCache: { q: string; gh: string | null } | null = null;
let userGeohashCache: string | null = null;

/** Geocode query for a selected location ('' when none is selected). */
export function locQuery(
  location: { country?: string; state?: string; city?: string },
  countryName: (code: string) => string,
): string {
  // 'XX' = the "Other" catch-all — there is nothing meaningful to geocode
  // (querying the literal word "Other" could pin a random place and filter
  // the feed against it), so it behaves like no selected location.
  if (!location.country || location.country === 'XX') return '';
  return [location.city, location.state, countryName(location.country)]
    .filter(Boolean)
    .join(', ');
}

/** Mount-time seed for the selected-location geocode.
 *  `settled: true` means the feed may render now (no selected location, or the
 *  cache already has THIS query — i.e. a tab-switch remount). `settled: false`
 *  means hold the feed until the geocode resolves (cold start / location just
 *  changed). */
export function locRefSeed(q: string): { gh: string | null; settled: boolean } {
  if (!q) return { gh: null, settled: true };
  if (locRefCache && locRefCache.q === q) return { gh: locRefCache.gh, settled: true };
  return { gh: null, settled: false };
}

/** Record a finished geocode for `q` (gh null = place not found — still settled). */
export function locRefStore(q: string, gh: string | null): void {
  locRefCache = { q, gh };
}

/** Whether the cache already covers this query (used by the resolve effect to
 *  decide between "hold the feed" and "refresh silently"). */
export function locRefHas(q: string): boolean {
  return !!locRefCache && locRefCache.q === q;
}

/** Mount-time seed for the device point (GPS, else coarse IP). */
export function userGeohashSeed(): string | null {
  return userGeohashCache;
}

export function userGeohashStore(gh: string): void {
  userGeohashCache = gh;
}

/** Tests only. */
export function _resetLocalityCache(): void {
  locRefCache = null;
  userGeohashCache = null;
}
