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
        const tok = (await w.tokenBalances()).find((x) => x.ticker.toUpperCase() === opts.token!.ticker.toUpperCase());
        if (!tok || !w.payToken) throw new Error('token unavailable');
        return w.payToken(address, tok, opts.token.amount);
      }
      return w.pay(address, opts.sats);
    },
  };
}
