/**
 * Geohash radius helpers, layered on the protocol's encode/decode.
 *
 * Nostr relay filters match tag VALUES exactly — there is no prefix or radius
 * operator. So a radius query needs the set of geohash cells that COVER the
 * circle, sent as a `#g` value list (relays OR within a tag). We then refine
 * client-side with haversine. `geohashesCovering` produces that cover.
 */
import { geohashEncode, geohashDecode } from '@freeport/protocol';

/** Approx geohash cell dimensions (km) at the equator, by precision. */
const CELL_KM: Record<number, { w: number; h: number }> = {
  1: { w: 5000, h: 5000 },
  2: { w: 1250, h: 625 },
  3: { w: 156, h: 156 },
  4: { w: 39, h: 19.5 },
  5: { w: 4.9, h: 4.9 },
  6: { w: 1.2, h: 0.61 },
  7: { w: 0.153, h: 0.153 },
};

/** Pick the coarsest precision whose cell is comfortably smaller than the
 *  radius, so the cover is a handful of cells rather than thousands.
 *  (Coarsest = LOWEST precision, so scan 1 → 7 and take the first hit;
 *  scanning 7 → 1 returns the finest instead, which for a 100 km radius
 *  meant ~50k precision-6 cells — the cap then kept only one edge of the
 *  bounding box and the search missed nearly the whole circle.) */
function precisionForRadius(radiusKm: number): number {
  for (let p = 1; p <= 7; p++) {
    if (CELL_KM[p].h <= radiusKm) return Math.min(p, 6);
  }
  return 6; // radius smaller than the finest cell — one fine cell covers it
}

/**
 * The set of geohash prefixes that cover a circle of `radiusKm` around a point.
 * Walks a grid stepped by the cell size over the radius bounding box and
 * encodes each grid point — robust, with none of the edge cases of geohash
 * neighbour adjacency. Capped so a pathological radius can't explode the set.
 */
export function geohashesCovering(
  lat: number,
  lon: number,
  radiusKm: number,
  precision?: number,
  cap = 64,
): string[] {
  let p = precision ?? precisionForRadius(radiusKm);
  // Coarsen until the whole grid fits the cap: hitting the cap mid-walk would
  // truncate the cover to one edge of the bounding box, silently excluding the
  // centre and most of the circle.
  while (!precision && p > 1) {
    const c = CELL_KM[p];
    const nLat = Math.ceil((2 * radiusKm) / c.h) + 1;
    const nLon = Math.ceil((2 * radiusKm) / c.w) + 1;
    if (nLat * nLon <= cap) break;
    p--;
  }
  const cell = CELL_KM[p] ?? CELL_KM[6];
  const latDeg = radiusKm / 111; // 1° lat ≈ 111 km
  const lonDeg = radiusKm / (111 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const stepLat = cell.h / 111;
  const stepLon = cell.w / (111 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const out = new Set<string>();
  // Centre cell first, so even a cap-truncated cover contains the point itself.
  out.add(geohashEncode(lat, lon, p));
  for (let dy = -latDeg; dy <= latDeg + 1e-9; dy += stepLat) {
    for (let dx = -lonDeg; dx <= lonDeg + 1e-9; dx += stepLon) {
      out.add(geohashEncode(lat + dy, lon + dx, p));
      if (out.size >= cap) return [...out];
    }
  }
  return [...out];
}

/** Great-circle distance (km) between a point and a decoded geohash, or null. */
export function distanceKmToGeohash(lat: number, lon: number, geohash: string): number | null {
  let c: { lat: number; lon: number };
  try {
    c = geohashDecode(geohash);
  } catch {
    return null;
  }
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(c.lat - lat);
  const dLon = toRad(c.lon - lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat)) * Math.cos(toRad(c.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
