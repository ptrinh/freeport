/**
 * Locale-tolerant money parsing.
 *
 * Payment amounts travel as locale-FORMATTED strings (e.g. a Vietnamese user
 * sees "5,50 SGD"), then get re-parsed on the other side. A naive parseFloat
 * drops the comma and reads "5,50" as 550 — the bug that turned a 5.50 SGD
 * counter-offer into 550 SGD. parseLocaleAmount treats the rightmost separator
 * as the decimal point unless it groups exactly 3 digits (a thousands group).
 */
export function parseLocaleAmount(str: string): number {
  const s = str.replace(/[^\d.,]/g, '');
  if (!s) return 0;
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (lastSep === -1) return parseInt(s, 10) || 0;
  const intDigits = s.slice(0, lastSep).replace(/[.,]/g, '');
  const frac = s.slice(lastSep + 1);
  if (/^\d{3}$/.test(frac)) return parseInt(intDigits + frac, 10) || 0; // thousands group, not a decimal
  return parseFloat(`${intDigits || '0'}.${frac}`) || 0;
}
