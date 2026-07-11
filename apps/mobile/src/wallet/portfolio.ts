/**
 * Portfolio math + locale-aware formatting for the wallet header.
 *
 * The big number totals BTC (via the BTC/fiat rate) plus stablecoins, which
 * are treated as USD-pegged (USDT/USDB) and converted to the local currency
 * through the USD→local cross rate (localRate/usdRate). Pure functions so
 * separator behavior ("." vs "," by locale) is unit-testable.
 */
import type { TokenBalanceInfo } from './types';

/**
 * Total portfolio value in the requested fiat unit, or null when the rates
 * needed for that unit are missing (caller falls back to BTC-only display).
 */
export function totalFiat(
  unit: 'usd' | 'local',
  sats: number | null,
  tokens: TokenBalanceInfo[],
  usdRate: number | null,
  localRate: number | null,
): number | null {
  const rate = unit === 'usd' ? usdRate : localRate;
  if (rate == null || sats == null) return null;
  const btc = (sats / 1e8) * rate;
  // Tokens are USD-pegged; in local mode cross through USD→local.
  const usdToUnit = unit === 'usd' ? 1 : usdRate ? localRate! / usdRate : null;
  if (usdToUnit == null) return null;
  const tokensValue = tokens.reduce((sum, t) => sum + (t.amount > 0 ? t.amount * usdToUnit : 0), 0);
  return btc + tokensValue;
}

/** Currency-formatted string, honoring the locale's separators. */
export function formatFiat(value: number, currency: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toLocaleString(locale, { maximumFractionDigits: 2 })} ${currency}`;
  }
}

/** Pill amount: locale separators, at most 2 fraction digits. */
export function formatPillAmount(amount: number, locale?: string): string {
  return amount.toLocaleString(locale, { maximumFractionDigits: 2 });
}


/**
 * The unit the header can actually honor: 'local' degrades to 'usd' when no
 * local rate exists (USD-market users, NWC wallets, transient rate failures),
 * and to 'sats' when there's no rate at all. 'usd' likewise degrades to
 * 'sats' without a USD rate.
 */
export function effectiveUnit(
  unit: 'sats' | 'usd' | 'local',
  usdRate: number | null,
  localRate: number | null,
): 'sats' | 'usd' | 'local' {
  if (unit === 'local') return localRate != null ? 'local' : usdRate != null ? 'usd' : 'sats';
  if (unit === 'usd') return usdRate != null ? 'usd' : 'sats';
  return 'sats';
}


/**
 * The asset pills under the balance, in display order: BTC (sats) first,
 * then each token. Zero balances are hidden; amounts cap at 2 fraction
 * digits with locale separators.
 */
export function buildAssetPills(
  balanceSats: number | null,
  tokens: TokenBalanceInfo[],
  locale?: string,
): Array<{ key: string; label: string }> {
  return [
    ...(balanceSats ? [{ key: 'sats', label: `${formatPillAmount(balanceSats, locale)} sats` }] : []),
    ...tokens
      .filter((t) => t.amount > 0)
      .map((t) => ({ key: t.id, label: `${formatPillAmount(t.amount, locale)} ${t.ticker}` })),
  ];
}
