/**
 * OpenStreetMap Nominatim helpers (no API key), shared by web AND native so
 * geocoding behaves identically on both.
 *
 * Reverse geocoding returns the address in the LOCATION's LOCAL language so the
 * local driver can read it. The public Nominatim defaults to English `name:en`
 * tags, so we can't just omit Accept-Language — instead we read the country
 * first, then re-query with that country's primary language (COUNTRY_LANG).
 * `reverseRaw` is the exception: it asks for English on purpose, because its
 * country/region/city feed our English location DB match.
 *
 * Native previously used expo-location, which follows the device OS locale with
 * no per-request override — that's why addresses came back in English. Routing
 * through Nominatim lets us control the language.
 */
export interface Coords { latitude: number; longitude: number }
export interface RawPlace { countryCode?: string; region?: string; city?: string }
export interface Suggestion { label: string; latitude: number; longitude: number }

const BASE = 'https://nominatim.openstreetmap.org';

/** ISO-3166 country → its primary language (ISO-639-1) for localized addresses. */
const COUNTRY_LANG: Record<string, string> = {
  VN: 'vi', TH: 'th', ID: 'id', MY: 'ms', PH: 'fil', KH: 'km', MM: 'my', LA: 'lo',
  CN: 'zh', HK: 'zh', TW: 'zh', JP: 'ja', KR: 'ko',
  IN: 'hi', BD: 'bn', PK: 'ur', LK: 'si', NP: 'ne',
  KZ: 'kk', UZ: 'uz', KG: 'ru', RU: 'ru', BY: 'ru', UA: 'uk',
  GE: 'ka', AM: 'hy', AZ: 'az', TR: 'tr',
  EG: 'ar', SA: 'ar', AE: 'ar', QA: 'ar', KW: 'ar', BH: 'ar', OM: 'ar', JO: 'ar',
  LB: 'ar', IQ: 'ar', MA: 'ar', DZ: 'ar', TN: 'ar', LY: 'ar',
  BR: 'pt', PT: 'pt',
  MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', EC: 'es', BO: 'es', UY: 'es',
  PY: 'es', VE: 'es', GT: 'es', CR: 'es', PA: 'es', DO: 'es', ES: 'es',
  FR: 'fr', BE: 'fr', DE: 'de', AT: 'de', CH: 'de', IT: 'it', NL: 'nl',
  PL: 'pl', RO: 'ro', GR: 'el', CZ: 'cs', SK: 'sk', HU: 'hu', BG: 'bg',
  HR: 'hr', RS: 'sr', SI: 'sl', SE: 'sv', NO: 'no', DK: 'da', FI: 'fi',
  EE: 'et', LV: 'lv', LT: 'lt', AL: 'sq', MK: 'mk',
  KE: 'sw', TZ: 'sw', ET: 'am',
};

// Short-TTL cache + in-flight dedup. The UI re-resolves the same coordinates
// repeatedly within a session (post form open/close, live pin, confirm screens
// — production breadcrumbs showed identical reverse lookups 3× in 45s), and
// reverseLine alone is two requests each time. Coordinates don't change their
// address in minutes, and Nominatim's usage policy asks callers to cache.
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 64;
const cache = new Map<string, { at: number; data: any | null }>();
const inflight = new Map<string, Promise<any | null>>();

async function fetchJson(path: string, acceptLang?: string): Promise<any | null> {
  const key = `${acceptLang ?? ''}|${path}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = fetchJsonUncached(path, acceptLang).then((data) => {
    inflight.delete(key);
    if (data != null) { // don't cache failures — retry next call
      if (cache.size >= CACHE_MAX) { const oldest = cache.keys().next().value; if (oldest != null) cache.delete(oldest); }
      cache.set(key, { at: Date.now(), data });
    }
    return data;
  });
  inflight.set(key, p);
  return p;
}

async function fetchJsonUncached(path: string, acceptLang?: string): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const tmr = setTimeout(() => ctrl.abort(), 6000);
    const headers: Record<string, string> = {
      // Identify the app per Nominatim's usage policy. Browsers silently drop a
      // UA override (harmless); native fetch sends it.
      'User-Agent': 'Freeport/1.0 (+https://freeport.network)',
    };
    if (acceptLang) headers['Accept-Language'] = acceptLang;
    const res = await fetch(`${BASE}/${path}&format=jsonv2`, { signal: ctrl.signal, headers });
    clearTimeout(tmr);
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * "<house> <road>, <suburb/district>, <city>" from a Nominatim address object.
 * `houseNumber` (a number the user typed) is kept when the result matched only
 * the street — e.g. "453 Ngọc Hồi" where OSM has no exact house 453, so the
 * driver still sees the number rather than just "Ngọc Hồi, …".
 */
function addressLine(a: any, fallbackName?: string, houseNumber?: string): string {
  const street = a.road || fallbackName; // primary line (road, else the place name)
  const hn = a.house_number || (houseNumber && street ? houseNumber : undefined);
  const parts = [
    [hn, street].filter(Boolean).join(' '),
    a.suburb || a.city_district || a.district || a.neighbourhood,
    a.city || a.town || a.village || a.state,
  ].filter((p: any) => p && String(p).trim().length > 0);
  return [...new Set(parts.map((p: any) => String(p)))].join(', ');
}

/**
 * Address in the location's LOCAL language. Step 1 reads the country (English);
 * step 2 re-queries in that country's language so the local driver can read it.
 */
export async function reverseLine(latitude: number, longitude: number): Promise<string> {
  const d0 = await fetchJson(`reverse?lat=${latitude}&lon=${longitude}`, 'en');
  if (!d0?.address) return d0?.display_name ?? '';
  const cc = d0.address.country_code ? String(d0.address.country_code).toUpperCase() : '';
  const lang = COUNTRY_LANG[cc];
  if (lang && lang !== 'en') {
    const d1 = await fetchJson(`reverse?lat=${latitude}&lon=${longitude}`, lang);
    if (d1?.address) return addressLine(d1.address);
  }
  return addressLine(d0.address);
}

/** Country/region/city in ENGLISH, for matching the curated location DB. */
export async function reverseRaw(latitude: number, longitude: number): Promise<RawPlace | null> {
  const d = await fetchJson(`reverse?lat=${latitude}&lon=${longitude}`, 'en');
  if (!d?.address) return null;
  const a = d.address;
  return {
    countryCode: a.country_code ? String(a.country_code).toUpperCase() : undefined,
    region: a.state || a.region,
    city: a.city || a.town || a.county,
  };
}

export async function forwardOne(name: string): Promise<Coords | null> {
  const d = await fetchJson(`search?q=${encodeURIComponent(name)}&limit=1`);
  const r = Array.isArray(d) ? d[0] : null;
  return r ? { latitude: parseFloat(r.lat), longitude: parseFloat(r.lon) } : null;
}

/**
 * Destination autocomplete. RESTRICTED to `countryCode` (the user's selected
 * location area) when given, and biased toward `near` (the pickup) via a
 * viewbox so nearby places rank first.
 *
 * Labels come back in the LOCATION's local language (COUNTRY_LANG), not the
 * passenger's app language, so the chosen destination is one the local driver
 * can read. The typed query still matches in any language — Nominatim resolves
 * "Noi Bai Airport" and "Sân bay Nội Bài" alike; we just localize the label.
 */
export async function suggest(
  query: string,
  near?: Coords | null,
  countryCode?: string | null,
  limit = 6,
): Promise<Suggestion[]> {
  if (query.trim().length < 3) return [];
  // Over-fetch when we have a pickup, so the client-side distance sort below has
  // candidates to reorder before we trim to `limit`.
  const fetchN = near ? Math.max(limit, 12) : limit;
  let path = `search?q=${encodeURIComponent(query)}&limit=${fetchN}&addressdetails=1`;
  if (countryCode) path += `&countrycodes=${countryCode.toLowerCase()}`;
  if (near) {
    const d = 0.35; // ~35 km box around the pickup → nudge Nominatim toward nearby
    path += `&viewbox=${near.longitude - d},${near.latitude + d},${near.longitude + d},${near.latitude - d}`;
  }
  // Label in the destination country's local language; fall back to ENGLISH
  // (not the passenger's app language) so places show their real name — e.g.
  // Singapore stays "Singapore", not the Vietnamese exonym "Tân Gia Ba".
  const localLang = (countryCode && COUNTRY_LANG[countryCode.toUpperCase()]) || 'en';
  const arr = await fetchJson(path, localLang);
  if (!Array.isArray(arr)) return [];
  // A leading house number the user typed (e.g. "453 Ngọc Hồi") — kept in the
  // label when the matched result is just the street.
  const typedHouseNo = (query.match(/^\s*(\d{1,5}[A-Za-z]?)\b/) || [])[1];
  const out = arr
    .map((r: any) => ({
      label: addressLine(r.address || {}, r.name, typedHouseNo) || r.display_name || '',
      latitude: parseFloat(r.lat),
      longitude: parseFloat(r.lon),
    }))
    .filter((s: Suggestion) => s.label && !Number.isNaN(s.latitude));
  if (near) {
    // Nearest to the pickup first (equirectangular approx — fine for ordering).
    const d2 = (s: Suggestion) => {
      const dla = s.latitude - near.latitude;
      const dlo = (s.longitude - near.longitude) * Math.cos((near.latitude * Math.PI) / 180);
      return dla * dla + dlo * dlo;
    };
    out.sort((a, b) => d2(a) - d2(b));
  }
  return out.slice(0, limit);
}
