/**
 * Distance filtering for the Browse feed.
 *
 * Rides are inherently local, so by DEFAULT they're hidden beyond NEAR_KM.
 * But the user's explicit "Max distance" preference overrides that default in
 * BOTH directions — setting 1000 km must actually show a ride 313 km away
 * (user report: raising Max distance to 1000 km still hid every post, because
 * the old code applied NEAR_KM first and the preference could only shrink it).
 *
 * Services/goods aren't distance-bound by default; only an explicit Max
 * distance hides them. Posts without a location are never hidden.
 */

import { categoryOf, subcategoryOf } from './categories';

/** Default locality radius for rides when the user has no Max distance set. */
export const NEAR_KM = 200;

/** Category/subcategory filter for the Browse feed.
 *
 *  The subcategory (vehicle class for rides) applies REGARDLESS of whether the
 *  Service/Product vertical is enabled — the old code skipped this entire
 *  filter when the vertical was off, so Settings' "Compact Car" default did
 *  nothing and a Luxury Car request still showed (user report). The category
 *  check still only matters with the vertical on (off = rideshare-only feed,
 *  already narrowed by schema). */
export function passesCategory(
  schema: string,
  payload: Record<string, any>,
  servicesEnabled: boolean,
  filterCat: string,
  filterSub: string | null,
): boolean {
  if (servicesEnabled && categoryOf(schema, payload) !== filterCat) return false;
  if (filterSub && subcategoryOf(schema, payload) !== filterSub) return false;
  return true;
}

/** The user's Max distance preference in km (they type it in their own unit). */
export function maxKmOf(maxDistance: number, unit: 'km' | 'mi'): number {
  return unit === 'mi' ? maxDistance * 1.60934 : maxDistance;
}

/** Whether a post at `km` from the user survives the distance filter.
 *  `km` null/unknown (no geohash, no reference point) → always visible, so
 *  discovery never silently breaks. `maxDistance` 0/unset → rides default to
 *  NEAR_KM, services unbounded. */
export function passesDistance(
  isRide: boolean,
  km: number | null,
  maxDistance: number,
  unit: 'km' | 'mi',
): boolean {
  if (km == null) return true;
  if (maxDistance > 0) return km <= maxKmOf(maxDistance, unit); // user pref wins
  return isRide ? km <= NEAR_KM : true;
}
