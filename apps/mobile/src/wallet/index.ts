/** Wallet provider registry — resolves the active provider from prefs. */
import { NwcProvider, parseNwcUrl } from './nwc';
import type { WalletProvider } from './types';

export { parseNwcUrl } from './nwc';
export type { WalletProvider, WalletBalance, WalletInvoice, WalletTx, WalletCapabilities } from './types';

/**
 * Build the active provider. Today only NWC is constructible; the embedded
 * Breez-Spark provider needs its native module in the binary and will slot in
 * here behind the same interface.
 */
export function walletProviderFor(nwcUrl: string): WalletProvider | null {
  const conn = parseNwcUrl(nwcUrl);
  return conn ? new NwcProvider(conn) : null;
}
