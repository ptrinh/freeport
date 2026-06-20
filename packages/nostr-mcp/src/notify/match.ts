/**
 * Decide whether a Nostr event matches a subscriber's filters.
 * Reuses the protocol's intent parsing + geohash for the radius test.
 */
import type { Event } from 'nostr-tools';
import { geohashDecode, parseIntentEvent, KIND_INTENT_OFFER, KIND_INTENT_REQUEST } from '@freeport/protocol';
import type { SubFilters } from './store.js';

export const DEFAULT_KINDS = [KIND_INTENT_OFFER, KIND_INTENT_REQUEST];

function haversineKm(lat: number, lon: number, gh: string): number | null {
  let c: { lat: number; lon: number };
  try { c = geohashDecode(gh); } catch { return null; }
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(c.lat - lat), dLon = toRad(c.lon - lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(c.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function eventGeohash(ev: Event): string | undefined {
  const g = ev.tags.find((t) => t[0] === 'g')?.[1];
  if (g) return g;
  const intent = parseIntentEvent(ev);
  const p = intent?.content.payload as any;
  return p?.from?.geohash || p?.location?.geohash || undefined;
}

export function matches(ev: Event, f: SubFilters): boolean {
  const kinds = f.kinds?.length ? f.kinds : DEFAULT_KINDS;
  if (!kinds.includes(ev.kind)) return false;

  if (f.topics?.length) {
    const evTopics = new Set(ev.tags.filter((t) => t[0] === 't').map((t) => t[1]));
    if (!f.topics.some((t) => evTopics.has(t))) return false;
  }

  if (f.near) {
    const gh = eventGeohash(ev);
    if (!gh) return false;
    const km = haversineKm(f.near.lat, f.near.lon, gh);
    if (km === null || km > f.near.radiusKm) return false;
  }
  return true;
}

/** The union of kinds across all subscriber filters — for the relay subscription. */
export function unionKinds(filters: SubFilters[]): number[] {
  const set = new Set<number>();
  for (const f of filters) for (const k of (f.kinds?.length ? f.kinds : DEFAULT_KINDS)) set.add(k);
  return set.size ? [...set] : DEFAULT_KINDS;
}
