/**
 * Deal price → wallet amount conversion.
 *
 * Deals carry a fiat price string ("S$5", "50.000 ₫"); the wallet speaks
 * sats. The Breez rate feed (fiat per BTC) bridges them at pay/receive time —
 * display-level conversion only, the agreed price stays fiat.
 */
import type { Currency } from '../locations';
import { currencyForMarket, currencyForCountry } from '../locations';
import { parsePayment } from '../ui/format';

/** Fiat amount → sats at `ratePerBtc` (that fiat per 1 BTC). */
export function satsForFiat(amount: number, ratePerBtc: number): number {
  if (!(amount > 0) || !(ratePerBtc > 0)) return 0;
  return Math.round((amount / ratePerBtc) * 1e8);
}

/** Parse a deal's payment string into {amount, currency} using the deal's
 *  market to frame the currency (the user's country as fallback). */
export function dealFiat(
  paymentText: string | undefined,
  market: string | undefined,
  userCountry: string,
): { amount: number; currency: Currency } | null {
  if (!paymentText) return null;
  const currency = currencyForMarket(market, currencyForCountry(userCountry));
  const parsed = parsePayment(paymentText, currency);
  return parsed.amount > 0 ? parsed : null;
}
