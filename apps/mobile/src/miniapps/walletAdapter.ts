/**
 * BridgeWallet adapter over the app's WalletProvider — shared by the native
 * and web shells. Resolved lazily so the wallet only spins up when a mini-app
 * actually asks for it.
 */
import type { WalletProvider } from '../wallet';
import { bolt11Sats } from '../wallet/bolt11';
import type { BridgeWallet } from './bridge';

export function makeBridgeWallet(getWallet: (() => Promise<WalletProvider | null>) | null): BridgeWallet | null {
  if (!getWallet) return null;
  const resolve = async (): Promise<WalletProvider> => {
    const w = await getWallet();
    if (!w) throw new Error('no wallet');
    return w;
  };
  return {
    makeInvoice: async (sats, memo) => (await (await resolve()).receive(sats, memo)).invoice,
    payInvoice: async (bolt11) => {
      const r = await (await resolve()).pay(bolt11);
      return { preimage: r.preimage ?? '' };
    },
    parseAmount: (bolt11) => bolt11Sats(bolt11),
    paySpark: async (address, opts) => {
      const w = await resolve();
      if (opts.token) {
        const want = opts.token.ticker.toUpperCase();
        const tok = (await w.tokenBalances().catch(() => []))
          .find((x) => x.ticker.toUpperCase() === want);
        if (tok && w.payToken) {
          // Enough of the stablecoin to cover the charge?
          if (tok.amount < opts.token.amount) throw new Error('insufficient balance');
          // Paid in stablecoin units, not sats → no sat spend to account for.
          return w.payToken(address, tok, opts.token.amount);
        }
        // Wallet holds no such stablecoin → pay the equivalent VALUE in sats
        // (treat the token amount as USD). Same destination, same worth — this
        // is what lets a sats-only wallet complete a USDT-denominated charge.
        const btcUsd = await w.fiatRate('USD').catch(() => null);
        if (!btcUsd || btcUsd <= 0) throw new Error('no exchange rate');
        const sats = Math.max(1, Math.round((opts.token.amount / btcUsd) * 100_000_000));
        const bal = await w.balance().catch(() => ({ sats: 0 }));
        if ((bal.sats || 0) < sats) throw new Error('insufficient balance');
        // Report the sats actually spent so the bridge can record it against caps.
        return { ...(await w.pay(address, sats)), sats };
      }
      const need = opts.sats || 0;
      const bal = await w.balance().catch(() => ({ sats: 0 }));
      if ((bal.sats || 0) < need) throw new Error('insufficient balance');
      return { ...(await w.pay(address, need)), sats: need };
    },
  };
}
