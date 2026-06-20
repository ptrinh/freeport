/**
 * Phone normalization & validation.
 *
 * Goal: whatever the user types ("5551234567", "15551234567", "+1 555 123 4567"),
 * store one canonical E.164 number and display a readable grouped form.
 * The default country code is detected from the device's IP at first use.
 */
import { t } from './i18n';

export interface CountryRule {
  code: string;            // ISO 3166-1 alpha-2
  dial: string;            // "+1"
  nationalLength: number[]; // valid digit counts after the dial code
  mobilePrefix?: RegExp;   // first digit(s) of the national number
  group: number[];         // display grouping of the national number
}

const COUNTRIES: CountryRule[] = [
  { code: 'VN', dial: '+84', nationalLength: [9], mobilePrefix: /^[35789]/, group: [2, 3, 4] },
  { code: 'SG', dial: '+65', nationalLength: [8], mobilePrefix: /^[3689]/, group: [4, 4] },
  { code: 'TH', dial: '+66', nationalLength: [9], group: [2, 3, 4] },
  { code: 'MY', dial: '+60', nationalLength: [9, 10], group: [2, 4, 4] },
  { code: 'ID', dial: '+62', nationalLength: [9, 10, 11], group: [3, 4, 4] },
  { code: 'PH', dial: '+63', nationalLength: [10], group: [3, 3, 4] },
  { code: 'US', dial: '+1', nationalLength: [10], group: [3, 3, 4] },
];

const DEFAULT_DIAL = '+1';

export interface NormalizedPhone {
  valid: boolean;
  /** Canonical E.164, e.g. "+15551234567" — what gets stored. */
  e164: string;
  /** Readable form, e.g. "+1 555 123 4567" — what the input shows. */
  formatted: string;
  country?: string;
  error?: string;
}

function countryByDial(e164: string): CountryRule | undefined {
  // Longest dial-code match wins (+1 vs +12 etc. — our list has no overlap, but be safe)
  return COUNTRIES
    .filter((c) => e164.startsWith(c.dial))
    .sort((a, b) => b.dial.length - a.dial.length)[0];
}

/**
 * "5551234567"        + default +1  → +15551234567
 * "15551234567"                     → +15551234567
 * "+1 555 123 4567"                 → +15551234567
 * "0011..." / "00 1" (intl 00)      → +1...
 */
export function normalizePhone(input: string, defaultDial: string = DEFAULT_DIAL): NormalizedPhone {
  let p = input.replace(/[\s.\-()]/g, '');
  if (!p) return { valid: false, e164: '', formatted: '', error: t('Empty number') };

  if (p.startsWith('00')) p = '+' + p.slice(2);

  let e164: string;
  if (p.startsWith('+')) {
    e164 = p;
  } else if (p.startsWith('0')) {
    // National format → swap the trunk 0 for the default country code
    e164 = defaultDial + p.slice(1);
  } else {
    // Bare digits: already starts with a known country code? Else assume national.
    const asIntl = '+' + p;
    const c = countryByDial(asIntl);
    if (c && c.nationalLength.includes(p.length - (c.dial.length - 1))) {
      e164 = asIntl;
    } else {
      e164 = defaultDial + p;
    }
  }

  if (!/^\+\d{7,15}$/.test(e164)) {
    return { valid: false, e164, formatted: e164, error: t('Not a valid phone number') };
  }

  const country = countryByDial(e164);
  if (!country) {
    // Unknown country code — accept generically (7–15 digits per E.164)
    return { valid: true, e164, formatted: e164 };
  }

  const national = e164.slice(country.dial.length);
  if (!country.nationalLength.includes(national.length)) {
    return {
      valid: false, e164, formatted: e164, country: country.code,
      error: t('{country} numbers have {expected} digits after {dial} (got {got})', { country: country.code, expected: country.nationalLength.join(' or '), dial: country.dial, got: national.length }),
    };
  }
  if (country.mobilePrefix && !country.mobilePrefix.test(national)) {
    return {
      valid: false, e164, formatted: e164, country: country.code,
      error: t("Doesn't look like a valid {country} mobile number", { country: country.code }),
    };
  }
  return { valid: true, e164, formatted: formatE164(e164, country), country: country.code };
}

function formatE164(e164: string, country: CountryRule): string {
  const national = e164.slice(country.dial.length);
  const parts: string[] = [];
  let i = 0;
  for (const g of country.group) {
    if (i >= national.length) break;
    parts.push(national.slice(i, i + g));
    i += g;
  }
  if (i < national.length) parts.push(national.slice(i));
  return `${country.dial} ${parts.join(' ')}`;
}

/**
 * Dial code for an ISO 3166-1 alpha-2 country, from the markets we know.
 * Returns undefined for countries not in our table — the caller then falls back
 * to an IP lookup (which covers any country) rather than guessing.
 */
export function dialForCountry(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return COUNTRIES.find((c) => c.code === code.toUpperCase())?.dial;
}

/**
 * Detect the user's dial code from their IP (best-effort, 3s timeout).
 * Returns null when it can't be determined — the caller must NOT assume a
 * default prefix in that case. Only the dial code is used — nothing is stored
 * or sent. Memoized: one network call per app session.
 */
let dialCodePromise: Promise<string | null> | null = null;
export function detectDialCode(): Promise<string | null> {
  if (!dialCodePromise) dialCodePromise = detectDialCodeUncached();
  return dialCodePromise;
}

async function detectDialCodeUncached(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('https://ipapi.co/json/', { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json();
    const dial = typeof data.country_calling_code === 'string' ? data.country_calling_code : '';
    if (/^\+\d{1,3}$/.test(dial)) return dial;
    // Fall back to deriving the dial code from the ISO country code if present.
    const fromCode = dialForCountry(typeof data.country_code === 'string' ? data.country_code : undefined);
    if (fromCode) return fromCode;
  } catch {}
  return null;
}
