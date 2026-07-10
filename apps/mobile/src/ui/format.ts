import { Platform } from 'react-native';
import { t, tn, getI18nLang } from '../i18n';
import { currencyFractionDigits, fmtMoney, type Currency } from '../locations';
import { parseAmountWithK } from '../money';
import { VEHICLE_SEATERS } from '../categories';
import type { Intent } from '@freeport/protocol';
import { s } from './theme';

/** Payment display formatter — alias of fmtMoney (single home for the name used across tabs). */
export const fmtPayment = fmtMoney;

// iOS Safari has no per-site permission icon in the address bar; once a site is
// denied, getCurrentPosition/Notification.requestPermission never re-prompt and
// the OS-level toggle can't override it. Recovery differs by context, so detect
// iOS-web and whether we're running as an installed (Home Screen) PWA.
export function isIOSWeb(): boolean {
  return Platform.OS === 'web' && typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent || '');
}
export function isStandalonePWA(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  try {
    return (navigator as any).standalone === true
      || (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches);
  } catch { return false; }
}

export function primaryGeohash(i: Intent): string | undefined {
  const p = i.content.payload as Record<string, any>;
  return i.content.schema.startsWith('rideshare') ? p.from?.geohash : p.location?.geohash;
}

/**
 * Trim a (often reverse-geocoded) place name to its leading components so ride
 * titles stay short — e.g. "123 Main St, Williamsburg, Brooklyn, New York"
 * → "123 Main St, Williamsburg". Already-short names pass through.
 */
export function shortPlace(name: string, maxParts = 2): string {
  return name.split(',').map((s) => s.trim()).filter(Boolean).slice(0, maxParts).join(', ');
}

/**
 * Vehicle option label: the (unchanged) translated category name with its seat
 * count appended, e.g. "Compact Car · 4 seaters". Vehicles with no known
 * capacity (e.g. Others) render the plain name.
 */
export function vehicleLabel(v: string): string {
  const n = VEHICLE_SEATERS[v];
  if (!n) return t(v);
  return tn(n, '{vehicle} · {n} seater', '{vehicle} · {n} seaters', { vehicle: t(v) });
}

/**
 * Title shown on ride cards (My Posts + Browse). Rides are rendered uniformly
 * as "📍<from> → <to> 🕓 <time>" derived from the payload — with the pickup
 * shortened to its leading components — so even older posts whose stored title
 * used the legacy/long format display the new short format. Non-ride posts keep
 * their stored title.
 */
export function myPostTitle(intent: Intent): string {
  if (!intent.content.schema.startsWith('rideshare')) return intent.content.title;
  const p = intent.content.payload as Record<string, any>;
  const from = shortPlace(String(p.from?.name ?? '').trim());
  const to = String(p.to?.name ?? '').trim();
  if (!from && !to) return intent.content.title;
  const win = intent.content.window;
  const timeStr = win ? ' 🕓 ' + fmtClockTitle(new Date(win.start * 1000)) : '';
  return `📍${from}${to ? ' → ' + to : ''}${timeStr}`;
}

/** Format an age in seconds as a short human string. */
export function formatAge(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  if (d < 1) return t('today');
  if (d < 30) return t('{n}d', { n: d });
  if (d < 365) return t('{n}mo', { n: Math.floor(d / 30) });
  return t('{n}y', { n: Math.floor(d / 365) });
}

/** Round to the nearest 15-minute mark. */
export function roundTo15(d: Date): Date {
  const step = 15 * 60 * 1000;
  return new Date(Math.round(d.getTime() / step) * step);
}

/** Default intent time: now + 30 min on the 15-minute grid (e.g. 2:15 PM). */
export function defaultIntentTime(): Date {
  return roundTo15(new Date(Date.now() + 30 * 60 * 1000));
}

export function fmtClock(d: Date): string {
  try {
    return new Intl.DateTimeFormat(getI18nLang(), { hour: 'numeric', minute: '2-digit' }).format(d);
  } catch {
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
  }
}

/** Clock time for a title, with a day suffix when it isn't today ("6:00 PM Tomorrow"). */
export function fmtClockTitle(d: Date): string {
  const clock = fmtClock(d);
  const hint = dayHint(d);
  if (hint === 'today') return clock;
  if (hint === 'tomorrow') return `${clock} ${t('Tomorrow')}`;
  return `${clock} ${hint}`;
}

/** Day bucket as a stable token ('today'/'tomorrow') or a locale-formatted date. */
export function dayHint(d: Date): string {
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'today';
  const tomorrow = new Date(today.getTime() + 86400000);
  if (d.toDateString() === tomorrow.toDateString()) return 'tomorrow';
  return d.toLocaleDateString(getI18nLang());
}

/** Translated day label for display (today/Tomorrow/date). */
export function dayLabel(d: Date): string {
  const h = dayHint(d);
  return h === 'today' ? t('today') : h === 'tomorrow' ? t('Tomorrow') : h;
}

export function timeToWindow(time: Date, flexible: boolean): { start: number; end: number } | undefined {
  if (flexible) return undefined;
  const start = Math.floor(time.getTime() / 1000);
  return { start, end: start + 15 * 60 };
}

/** Input snapping step: VND 5000, other zero-decimal currencies 1000, else 0.5. */
export function stepFor(currency: Currency): number {
  if (currency === 'VND') return 5000;
  return currencyFractionDigits(currency) === 0 ? 1000 : 0.5;
}

export function snapToStep(amount: number, currency: Currency): number {
  const step = stepFor(currency);
  return Math.max(0, Math.round(amount / step) * step);
}

/**
 * Parse a number out of a money string formatted in ANY locale. `fmtMoney`
 * localises decimals — German writes 5.50 as "5,50" and 1234.50 as
 * "1.234,50", English as "5.50" / "1,234.50" — so a fixed dot-only parse turned
 * a VI "5,50" counter into 550. Treat the rightmost '.'/',' as the decimal
 * point, unless it's followed by a 3-digit group (then it's thousands, no
 * decimal). Currency symbols and stray marks are ignored.
 */
/** Best-effort parse of a payment string back into amount+currency (for counter-offers). */
export function parsePayment(str: string | undefined, fallbackCurrency: Currency): { amount: number; currency: Currency } {
  if (!str) return { amount: 0, currency: fallbackCurrency };
  // Currency is fixed by each user's locale, so the offer's own currency
  // (fallbackCurrency) is the right frame; we only special-case VND's distinct
  // formatting since its amounts have no decimals and use dot grouping.
  const currency: Currency = /₫|đ|vnd/i.test(str) ? 'VND' : fallbackCurrency;
  const amount = parseAmountWithK(str, currencyFractionDigits(currency));
  return { amount: snapToStep(amount, currency), currency };
}

/** Some locales conventionally write the currency mark after the number
 * (e.g. Polish "10,00 zł"), unlike the leading "$10" form. */
export function symbolIsSuffix(currency: Currency): boolean {
  return currency === 'VND';
}

/** Compact label for a wheel's major (10×) tick, e.g. 50000 → "50k", 5 → "5". */
export function compactAmount(n: number, currency: Currency): string {
  if (currencyFractionDigits(currency) === 0) {
    if (n >= 1000) {
      const k = n / 1000;
      return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
    }
    return String(n);
  }
  return String(n);
}

/**
 * Format a raw amount string for the editable readout with thin-grouped
 * thousands (e.g. "70000" → "70 000"), keeping a single decimal point for
 * fractional currencies. Spaces are non-digits, so `commit()`'s digit-stripping
 * parses it back unchanged.
 */
export function formatAmountInput(raw: string, currency: Currency): string {
  if (currencyFractionDigits(currency) === 0) {
    const digits = raw.replace(/\D/g, '');
    return digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '';
  }
  let cleaned = raw.replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot !== -1) cleaned = cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
  const [intPart, decPart] = cleaned.split('.');
  const grouped = (intPart || '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return decPart !== undefined ? `${grouped}.${decPart}` : grouped;
}

/** "npub1hewi3…xyzaerh2n" → "npub1he...aerh2n" */
export function shortNpub(npub: string): string {
  if (npub.length <= 16) return npub;
  return `${npub.slice(0, 7)}...${npub.slice(-6)}`;
}

export function fmtWindow(w: { start: number; end: number }): string {
  const lang = getI18nLang();
  return `${new Date(w.start * 1000).toLocaleString(lang)} → ${new Date(w.end * 1000).toLocaleTimeString(lang)}`;
}

/** Extract a callable full phone number from a string; null if masked/missing. */
export function extractPhone(strInput?: string): string | null {
  if (!strInput) return null;
  const m = strInput.match(/\+?\d[\d\s().-]{6,}\d/);
  if (!m) return null;
  const digits = m[0].replace(/[^\d+]/g, '');
  return /^\+?\d{8,15}$/.test(digits) ? digits : null;
}

/** A "·"-joined contact string with the phone part removed — used when a Call
 *  button already shows the number, so it isn't repeated on the contact line. */
export function contactWithoutPhone(contact?: string, phone?: string | null): string {
  const c = (contact ?? '').trim();
  if (!c) return '—';
  const digits = (phone ?? '').replace(/\D/g, '');
  const parts = c.split('·').map((s) => s.trim()).filter(Boolean)
    .filter((part) => !(digits.length >= 6 && part.replace(/\D/g, '').includes(digits)));
  return parts.join(' · ') || '—';
}

// English label (= i18n key) for a negotiation state chip; t()'d at the call site
// so the chip never shows the raw machine state (e.g. "confirmed", "open").
export function stateLabel(state: string): string {
  switch (state) {
    case 'open': return 'Open';
    case 'accepted_by_them': return 'Offer accepted';
    case 'confirmed': return 'Confirmed';
    case 'cancelled': return 'Cancelled';
    case 'expired': return 'Expired';
    case 'cancel_requested': return 'Cancellation requested';
    default: return state.replace(/_/g, ' ');
  }
}

export function stateColor(state: string) {
  if (state === 'confirmed') return s.chipGreen;
  if (state === 'cancelled' || state === 'expired') return s.chipRed;
  if (state === 'cancel_requested') return s.chipYou;
  if (state.startsWith('accepted')) return s.chipBlue;
  return {};
}
