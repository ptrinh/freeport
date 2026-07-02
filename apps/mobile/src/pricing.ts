/**
 * Price suggestion (v1) — derived from PUBLIC asking prices only.
 *
 * The settled deal price lives in encrypted negotiation terms and is not
 * visible, so this suggests a *typical asking price* from comparable public
 * intents — never a "market/settled price". Label it as asking accordingly.
 *
 * Robustness:
 * - Comparables are matched by schema family + category (+ subcategory) +
 *   currency. Services normalise to price-per-hour when a duration exists.
 * - Weighted by the author's reputation (trusted/in-network asks count more;
 *   new accounts count less), so a few fake asks can't drag the figure.
 * - median + trimmed p25–p75 (not mean) resist outliers.
 * - Needs a minimum sample; widens subcategory→category if too few.
 */
import type { Intent } from '@freeport/protocol';
import type { Reputation } from './reputation';
import type { Currency } from './locations';
import { currencyFractionDigits, currencySymbol } from './locations';
import { parseAmountWithK } from './money';
import { categoryOf, subcategoryOf } from './categories';

/**
 * Rough ride-fare estimate from trip distance, vehicle and currency — a
 * starting point for the offer, not a quote. Per-currency {base, perKm} rates
 * (in that currency's own units) reflect typical app-hailing prices; vehicle
 * multipliers scale them. Currencies without a baseline return null so we never
 * show a misleading number (the field just stays empty for them).
 */
const FARE_RATES: Record<string, { base: number; perKm: number }> = {
  VND: { base: 12000, perKm: 11000 },
  USD: { base: 2, perKm: 1.2 },
  EUR: { base: 2, perKm: 1.1 },
  GBP: { base: 2, perKm: 1.2 },
  SGD: { base: 3, perKm: 0.7 },
  AUD: { base: 3, perKm: 1.4 },
  THB: { base: 35, perKm: 12 },
  IDR: { base: 8000, perKm: 4000 },
  INR: { base: 30, perKm: 14 },
  PHP: { base: 40, perKm: 15 },
  MYR: { base: 4, perKm: 1.5 },
  BRL: { base: 6, perKm: 2.2 },
  MXN: { base: 25, perKm: 9 },
  ZAR: { base: 20, perKm: 9 },
  NGN: { base: 600, perKm: 300 },
  PKR: { base: 120, perKm: 45 },
  BDT: { base: 50, perKm: 25 },
  EGP: { base: 20, perKm: 9 },
  KES: { base: 120, perKm: 45 },
  RUB: { base: 100, perKm: 35 },
  TRY: { base: 30, perKm: 14 },
  JPY: { base: 400, perKm: 220 },
  KRW: { base: 3500, perKm: 1500 },
  CNY: { base: 12, perKm: 2.5 },
};
// Markets with heavy urban congestion — rush-hour pricing bites harder here.
const SEVERE_TRAFFIC = new Set([
  'VN', 'ID', 'IN', 'TH', 'PH', 'BD', 'PK', 'NG', 'EG', 'BR', 'MX', 'KE', 'LK', 'NP', 'CN', 'CO',
]);

/** Every coefficient the fare estimate uses — all user-editable in Settings. */
export interface FareConfig {
  base: number;        // fixed starting price (in the user's currency)
  perKm: number;       // price per km (straight-line, before roadFactor)
  roadFactor: number;  // straight-line → driving distance multiplier (~1.15)
  vehicle: Record<string, number>; // per-vehicle multiplier
  peakSurge: number;   // additive at rush hour, e.g. 0.5 → ×1.5
  nightFactor: number; // late-night multiplier, e.g. 1.1
}

/** The built-in defaults for a currency/country (what the editor seeds from). */
export function defaultFareConfig(currency: Currency, countryCode?: string): FareConfig {
  const r = FARE_RATES[currency] ?? { base: 0, perKm: 0 };
  return {
    base: r.base,
    perKm: r.perKm,
    roadFactor: 1.15,
    vehicle: { Motorbike: 0.55, 'Compact Car': 1, 'Large Car': 1.4, 'Luxury Car': 2.2 },
    peakSurge: SEVERE_TRAFFIC.has((countryCode || '').toUpperCase()) ? 0.5 : 0.3,
    nightFactor: 1.1,
  };
}

// User override (from prefs). When set it replaces the built-in defaults for
// ALL currencies — the user only ever estimates in their own currency.
let userFareConfig: FareConfig | null = null;
export function setFareConfig(cfg: FareConfig | null): void { userFareConfig = cfg; }
export function getActiveFareConfig(currency: Currency, countryCode?: string): FareConfig {
  return userFareConfig ?? defaultFareConfig(currency, countryCode);
}

/** Peak surge for the ride's local clock time using the active config. */
function surge(when: Date | null | undefined, cfg: FareConfig): number {
  if (!when) return 1;
  const h = when.getHours();
  const day = when.getDay(); // 0=Sun … 6=Sat
  const weekday = day >= 1 && day <= 5;
  if (weekday && ((h >= 7 && h < 10) || (h >= 16 && h < 20))) return 1 + cfg.peakSurge;
  if (h >= 22 || h < 5) return cfg.nightFactor;
  return 1;
}

/** Estimated fare, or null when distance is unknown / no rate baseline exists. */
export function estimateFare(
  km: number,
  vehicle: string,
  currency: Currency,
  when?: Date | null,
  countryCode?: string,
): number | null {
  const cfg = getActiveFareConfig(currency, countryCode);
  if (!(km > 0) || (cfg.base === 0 && cfg.perKm === 0)) return null;
  const mult = cfg.vehicle[vehicle] ?? 1;
  const fare = (cfg.base + cfg.perKm * km * cfg.roadFactor) * mult;
  return fare * surge(when, cfg);
}

export interface PriceSuggestion {
  currency: Currency;
  median: number;
  p25: number;
  p75: number;
  n: number;
  basis: 'absolute' | 'per_hour';
  scope: 'exact' | 'widened';
}

export interface PriceInput {
  schemaPrefix: 'rideshare' | 'service';
  category: string;
  subcategory?: string;
  currency: Currency;
  /** Service only — enables per-hour normalisation and scales the result. */
  durationMin?: number;
}

const MIN_N = 3;

/** Does a payment string belong to the given currency? (symbol/code match). */
function paymentInCurrency(s: string, cur: Currency): boolean {
  if (cur === 'VND') return /₫|đ|vnd/i.test(s);
  if (new RegExp(`\\b${cur}\\b`, 'i').test(s)) return true;
  const sym = currencySymbol(cur);
  if (!sym || sym === cur) return false;
  // A bare "$" must not claim "S$"/"A$"/"HK$" asks from other dollar
  // currencies — that mixed USD medians with SGD/AUD asks. Require the symbol
  // not be the tail of a longer, letter-prefixed symbol.
  const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z])${esc}`).test(s);
}

// Locale-aware: "5,50" is five-and-a-half (not 550), "12.5k" is 12,500, and
// KWD-style 3-decimal amounts keep their fraction. See money.ts.
function parseAmount(s: string, cur: Currency): number {
  return parseAmountWithK(s, currencyFractionDigits(cur));
}

function weightFor(pubkey: string, reps: Map<string, Reputation>): number {
  const r = reps.get(pubkey);
  if (!r) return 1;
  let w = 1 + Math.max(0, Math.min(r.score, 2)) * 0.5 + Math.min(r.partnersInNetwork, 5) * 0.3;
  if (r.newAccount) w *= 0.5;
  return w;
}

/** Weighted percentiles over {v,w} samples (samples need not be pre-sorted). */
function weightedPercentiles(samples: { v: number; w: number }[], ps: number[]): number[] {
  const sorted = [...samples].sort((a, b) => a.v - b.v);
  const total = sorted.reduce((sum, x) => sum + x.w, 0);
  const targets = ps.map((p) => p * total);
  const out = ps.map(() => sorted[sorted.length - 1].v);
  let cum = 0;
  let ti = 0;
  for (const x of sorted) {
    cum += x.w;
    while (ti < targets.length && cum >= targets[ti]) { out[ti] = x.v; ti++; }
  }
  return out;
}

export function suggestPrice(
  input: PriceInput,
  intents: Intent[],
  reputations: Map<string, Reputation>,
): PriceSuggestion | null {
  const perHour = input.schemaPrefix === 'service' && !!input.durationMin && input.durationMin > 0;
  const basis: PriceSuggestion['basis'] = perHour ? 'per_hour' : 'absolute';

  const collect = (matchSub: boolean): { v: number; w: number }[] => {
    const out: { v: number; w: number }[] = [];
    for (const i of intents) {
      if (!i.content.schema.startsWith(input.schemaPrefix)) continue;
      const pl = i.content.payload as Record<string, any>;
      if (categoryOf(i.content.schema, pl) !== input.category) continue;
      if (matchSub && input.subcategory && subcategoryOf(i.content.schema, pl) !== input.subcategory) continue;
      const pay = pl.payment;
      if (typeof pay !== 'string' || !pay) continue;
      if (!paymentInCurrency(pay, input.currency)) continue;
      let amt = parseAmount(pay, input.currency);
      if (amt <= 0) continue;
      if (perHour) {
        const dur = pl.duration_minutes;
        if (!dur || dur <= 0) continue;
        amt = amt / (dur / 60); // normalise to price/hour
      }
      out.push({ v: amt, w: weightFor(i.pubkey, reputations) });
    }
    return out;
  };

  let samples = collect(true);
  let scope: PriceSuggestion['scope'] = 'exact';
  if (samples.length < MIN_N) { samples = collect(false); scope = 'widened'; }
  if (samples.length < MIN_N) return null;

  // Trim 10% off each end (by value) to drop extreme outliers.
  samples.sort((a, b) => a.v - b.v);
  const trim = Math.floor(samples.length * 0.1);
  const trimmed = samples.slice(trim, samples.length - trim);
  const eff = trimmed.length >= MIN_N ? trimmed : samples;

  const [p25, median, p75] = weightedPercentiles(eff, [0.25, 0.5, 0.75]);
  const scale = perHour && input.durationMin ? input.durationMin / 60 : 1;
  return {
    currency: input.currency,
    median: median * scale,
    p25: p25 * scale,
    p75: p75 * scale,
    n: eff.length,
    basis,
    scope,
  };
}
