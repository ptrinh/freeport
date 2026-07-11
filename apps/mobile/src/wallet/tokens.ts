/**
 * Token (stablecoin) amount conversions — decimal-string safe.
 * Spark tokens (USDT, USDB…) carry a `decimals` in their metadata; balances
 * and send amounts are integer base units. Parsing goes through strings so
 * "12.34" with 6 decimals is exactly 12340000n (no float drift).
 */

/** "12.34" | 12.34 → base units (bigint). Throws on malformed input. */
export function toBaseUnits(amount: string | number, decimals: number): bigint {
  const s = String(amount).trim();
  const m = s.match(/^(\d+)(?:\.(\d*))?$/);
  if (!m) throw new Error('bad-amount');
  const frac = (m[2] ?? '').slice(0, decimals).padEnd(decimals, '0');
  return BigInt(m[1] + frac);
}

/** base units → human number (display only; fine within 2^53). */
export function fromBaseUnits(units: bigint | number, decimals: number): number {
  return Number(units) / 10 ** decimals;
}

/** base units → exact display string, trailing zeros trimmed ("12.34"). */
export function formatBaseUnits(units: bigint | number, decimals: number): string {
  const neg = BigInt(units) < 0n;
  const u = (neg ? -BigInt(units) : BigInt(units)).toString().padStart(decimals + 1, '0');
  const int = u.slice(0, u.length - decimals) || '0';
  const frac = decimals ? u.slice(u.length - decimals).replace(/0+$/, '') : '';
  return (neg ? '-' : '') + int + (frac ? '.' + frac : '');
}
