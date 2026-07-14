/**
 * BridgeContext provider — resolves the PRIVATE read signals a mini-app may
 * request: wallet balance and coarse home location. Both are non-public (they
 * never touch a relay), so a mini-app cannot obtain them from the npub alone.
 *
 * Anything public — reputation, karma, deal counts, account age — is
 * deliberately NOT here: it is derivable from the npub the app already gets
 * via getPublicKey, so the app looks it up itself rather than us re-exposing
 * it. Balance is reduced to a sats total; location to country/state/city.
 */
import { loadPrefs } from '../prefs';
import type { WalletProvider } from '../wallet';
import type { BridgeContext } from './bridge';

export function makeBridgeContext(
  getWallet: (() => Promise<WalletProvider | null>) | null,
): BridgeContext {
  return {
    balance: async () => {
      const w = getWallet ? await getWallet() : null;
      if (!w) return { sats: 0 };
      const b = await w.balance();
      return { sats: Math.max(0, Math.floor(b.sats)) };
    },
    location: async () => {
      const p = await loadPrefs();
      return { country: p.location.country, state: p.location.state, city: p.location.city };
    },
  };
}
