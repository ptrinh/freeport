/**
 * Topic-tag sharding. Each intent carries several `t` tags at increasing
 * specificity so subscribers can pick how narrow a slice they want:
 *
 *   vn_hanoi                          ← everything in the area
 *   vn_hanoi_ridesharing              ← + category
 *   vn_hanoi_ridesharing_compactcar   ← + subcategory
 *
 * Area is country + the most specific location the user set (city or state).
 * Raw geohash is intentionally NOT used here — a ~5km cell over-fragments the
 * topic space; geohash stays for client-side "Nearby" sorting. Discovery is
 * therefore scoped to a shared area: two users see each other when their set
 * locations resolve to the same area key.
 */
import type { UserLocation } from './prefs';
import { categoryOf, subcategoryOf } from './categories';

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, '');
}

/** Country + most-specific location → "vn_hanoi", "sg", "us_losangeles". */
export function areaKey(location: UserLocation): string {
  const parts = [location.country, location.city || location.state]
    .filter(Boolean)
    .map(slug)
    .filter(Boolean);
  return parts.length ? parts.join('_') : 'global';
}

/** The `t` tags to attach to a posted intent. */
export function intentTopics(location: UserLocation, category: string, subcategory?: string): string[] {
  const area = areaKey(location);
  const cat = slug(category);
  const tags = [area];
  if (cat) tags.push(`${area}_${cat}`);
  if (cat && subcategory) tags.push(`${area}_${cat}_${slug(subcategory)}`);
  return tags;
}

/** Same derivation, but from an intent's schema + payload (for any consumer). */
export function intentTopicsFor(location: UserLocation, schema: string, payload: Record<string, unknown>): string[] {
  return intentTopics(location, categoryOf(schema, payload), subcategoryOf(schema, payload));
}

/**
 * The `t` tag Browse should subscribe to, given the user's location and the
 * current filter. Narrows relay-side load to the chosen slice.
 */
export function browseTopic(
  location: UserLocation,
  opts: { servicesEnabled: boolean; filterCat: string; filterSub: string | null },
): string {
  const area = areaKey(location);
  if (!opts.servicesEnabled) return `${area}_ridesharing`;
  if (opts.filterCat === 'All') return area;
  const cat = slug(opts.filterCat);
  if (opts.filterSub) return `${area}_${cat}_${slug(opts.filterSub)}`;
  return `${area}_${cat}`;
}
