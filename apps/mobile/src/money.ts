/**
 * Locale-tolerant money parsing.
 *
 * Payment amounts travel as locale-FORMATTED strings (e.g. a German user
 * sees "5,50 SGD"), then get re-parsed on the other side. A naive parseFloat
 * drops the comma and reads "5,50" as 550 — the bug that turned a 5.50 SGD
 * counter-offer into 550 SGD. parseLocaleAmount treats the rightmost separator
 * as the decimal point unless it groups exactly 3 digits (a thousands group).
 *
 * `fractionDigits` is the currency's minor-unit count. It matters for the
 * 3-minor-unit currencies (KWD/BHD/OMR/JOD/TND…): there "5.500" IS five and a
 * half — formatted with 3 decimals — not five thousand five hundred.
 */
export function parseLocaleAmount(str: string, fractionDigits = 2): number {
  const s = str.replace(/[^\d.,]/g, '');
  if (!s) return 0;
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (lastSep === -1) return parseInt(s, 10) || 0;
  const intDigits = s.slice(0, lastSep).replace(/[.,]/g, '');
  const frac = s.slice(lastSep + 1);
  if (/^\d{3}$/.test(frac) && fractionDigits < 3) return parseInt(intDigits + frac, 10) || 0; // thousands group, not a decimal
  return parseFloat(`${intDigits || '0'}.${frac}`) || 0;
}

/**
 * Parse an amount that may use the "12.5k" shorthand common in 0-minor-unit
 * markets (VND, IDR…): the k multiplies the LOCALE-PARSED number, so
 * "12.5k" → 12,500 — not 125,000 (the digits-only-then-×1000 bug).
 */
export function parseAmountWithK(str: string, fractionDigits = 2): number {
  const k = /([\d.,]+)\s*k\b/i.exec(str);
  if (k) return Math.round(parseLocaleAmount(k[1]) * 1000);
  return parseLocaleAmount(str, fractionDigits);
}
