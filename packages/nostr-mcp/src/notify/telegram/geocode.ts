/**
 * Minimal Nominatim geocoding for guest posts: an address or SG postal code →
 * { name, lat, lon }. Respects the Nominatim usage policy — a descriptive
 * User-Agent, a global 1 req/s throttle, and an in-memory LRU cache so repeated
 * places (Orchard, Changi…) don't re-hit the API.
 */
import { geohashEncode } from '@freeport/protocol';

export interface GeoPoint { name: string; lat: number; lon: number; geohash: string }

const UA = 'Freeport/1.0 (+https://freeport.network)';
const CACHE_MAX = 500;

export class Geocoder {
  private cache = new Map<string, GeoPoint | null>();
  private lastAt = 0;

  constructor(
    private readonly base = process.env.NOMINATIM_BASE ?? 'https://nominatim.openstreetmap.org',
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Resolve free text (or a 6-digit SG postal code) to a point, or null. */
  async lookup(query: string, countryHint?: string): Promise<GeoPoint | null> {
    const key = query.trim().toLowerCase();
    if (!key) return null;
    if (this.cache.has(key)) return this.cache.get(key)!;

    await this.throttle();
    const params = new URLSearchParams({ format: 'jsonv2', limit: '1', addressdetails: '0' });
    if (/^\d{6}$/.test(key)) { params.set('postalcode', key); params.set('countrycodes', countryHint ?? 'sg'); }
    else { params.set('q', query.trim()); if (countryHint) params.set('countrycodes', countryHint); }

    let point: GeoPoint | null = null;
    try {
      const res = await this.fetchImpl(`${this.base}/search?${params.toString()}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.ok) {
        const arr = (await res.json()) as Array<{ lat: string; lon: string; display_name?: string }>;
        if (arr[0]) {
          const lat = Number(arr[0].lat), lon = Number(arr[0].lon);
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            const name = arr[0].display_name?.split(',')[0]?.trim() || query.trim();
            point = { name, lat, lon, geohash: geohashEncode(lat, lon, 6) };
          }
        }
      }
    } catch { /* network error → null */ }

    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, point);
    return point;
  }

  /** A Telegram location pin → a point (no API call needed). */
  fromPin(lat: number, lon: number, name = 'Pinned location'): GeoPoint {
    return { name, lat, lon, geohash: geohashEncode(lat, lon, 6) };
  }

  private async throttle(): Promise<void> {
    const wait = this.lastAt + 1000 - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastAt = this.now();
  }
}
