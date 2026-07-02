/**
 * Minimal geohash implementation — encode, decode, and prefix proximity.
 * Enough for location-scoped market filtering; no external dependency.
 */
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohashEncode(lat: number, lon: number, precision = 6): string {
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  let hash = '';
  let bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) { ch = (ch << 1) | 1; lonMin = mid; }
      else { ch = ch << 1; lonMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; latMin = mid; }
      else { ch = ch << 1; latMax = mid; }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0; ch = 0;
    }
  }
  return hash;
}

export function geohashDecode(hash: string): { lat: number; lon: number } {
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  let even = true;
  for (const c of hash.toLowerCase()) {
    const idx = BASE32.indexOf(c);
    if (idx === -1) throw new Error(`invalid geohash char: ${c}`);
    for (let b = 4; b >= 0; b--) {
      const bit = (idx >> b) & 1;
      if (even) {
        const mid = (lonMin + lonMax) / 2;
        if (bit) lonMin = mid; else lonMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bit) latMin = mid; else latMax = mid;
      }
      even = !even;
    }
  }
  return { lat: (latMin + latMax) / 2, lon: (lonMin + lonMax) / 2 };
}

/**
 * All prefixes of a geohash from precision 1 up to `maxPrecision`, for `g`
 * tags. Relay `#g` filters match tag values EXACTLY (no prefix operator), so
 * an intent must carry every precision a radius query might pick — a single
 * precision-5 tag is invisible to a precision-4 cover and vice versa.
 */
export function geohashPrefixes(geohash: string, maxPrecision = 6): string[] {
  const g = geohash.toLowerCase();
  const out: string[] = [];
  for (let p = 1; p <= Math.min(g.length, maxPrecision); p++) out.push(g.slice(0, p));
  return out;
}

/**
 * Proximity by shared prefix length. 5 shared chars ≈ within ~2.4km,
 * 4 ≈ ~20km. Good enough for "same neighborhood" matching in v1.
 */
export function geohashSharedPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

export function geohashNear(a: string, b: string, minSharedPrefix = 5): boolean {
  return geohashSharedPrefix(a.toLowerCase(), b.toLowerCase()) >= minSharedPrefix;
}
