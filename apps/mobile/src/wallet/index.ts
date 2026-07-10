/** Wallet provider registry — resolves the active provider from prefs. */
import { NwcProvider, parseNwcUrl } from './nwc';
import type { WalletProvider } from './types';

export { parseNwcUrl } from './nwc';
export type { WalletProvider, WalletBalance, WalletInvoice, WalletTx, WalletCapabilities } from './types';

/**
 * Bring-your-own provider: constructed synchronously from a stored NWC url.
 */
export function walletProviderFor(nwcUrl: string): WalletProvider | null {
  const conn = parseNwcUrl(nwcUrl);
  return conn ? new NwcProvider(conn) : null;
}

/**
 * Provider for background wallet operations (sharing our receive address on
 * accept, paying a deal): the stored NWC wallet when configured, otherwise
 * the built-in one. NWC instances are cached per connection string.
 */
let nwcCache: { url: string; provider: WalletProvider } | null = null;
export async function activeWalletProvider(nwcUrl: string): Promise<WalletProvider | null> {
  if (nwcUrl) {
    if (nwcCache?.url !== nwcUrl) {
      nwcCache?.provider.close();
      const p = walletProviderFor(nwcUrl);
      nwcCache = p ? { url: nwcUrl, provider: p } : null;
    }
    return nwcCache?.provider ?? null;
  }
  return defaultWalletProvider();
}

/**
 * Default provider: the built-in Breez-Spark wallet, lazy-loaded on first
 * use and kept as an app-lifetime singleton (it syncs in the background;
 * BreezSparkProvider.close() is a no-op). Resolves null when unavailable —
 * no API key in this build, no identity yet, or a binary without the native
 * module — and a failed attempt is not cached, so a later call retries.
 */
let breezSingleton: Promise<WalletProvider | null> | null = null;
export function defaultWalletProvider(): Promise<WalletProvider | null> {
  if (!breezSingleton) {
    breezSingleton = (async () => {
      try {
        const p = await (await import('./breez')).connectBreez();
        if (!p) breezSingleton = null;
        return p;
      } catch (e) {
        // Always logged: a silently-dead wallet is undiagnosable in the field.
        console.warn('built-in wallet unavailable:', e);
        breezSingleton = null;
        return null;
      }
    })();
  }
  return breezSingleton;
}
