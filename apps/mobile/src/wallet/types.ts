/**
 * Pluggable wallet layer (see docs/ROADMAP.md "In-app wallet").
 *
 * One interface, multiple providers:
 *  - `nwc` (Nostr Wallet Connect, NIP-47): bring-your-own wallet — pure JS
 *    over the existing nostr-tools stack, works on every surface via OTA.
 *  - `breez-spark` (planned): the embedded self-custodial wallet. Its SDK is
 *    a native module, so it can only arrive with a new store binary; until
 *    then the UI shows it as "coming soon".
 *
 * Amounts are SATS everywhere in this layer (NIP-47 speaks msats; providers
 * convert at the boundary).
 */

export interface WalletCapabilities {
  /** Lightning BTC send/receive. */
  lightning: boolean;
  /** Stablecoin balance/denomination (Breez Spark only). */
  stablecoin: boolean;
  /** Provider can list past transactions. */
  transactions: boolean;
}

export interface WalletBalance {
  sats: number;
}

export interface WalletInvoice {
  /** bolt11 payment request. */
  invoice: string;
  /** sats requested (0 = any amount). */
  sats: number;
}

export interface WalletTx {
  direction: 'in' | 'out';
  sats: number;
  description?: string;
  /** Unix seconds. */
  ts: number;
  /** True once settled (NWC list_transactions may include pending ones). */
  settled: boolean;
}

/** Simplified parse result for the Send flow (subset of the SDK's InputType). */
export type ParsedDest =
  | { kind: 'bolt11'; raw: string; sats: number | null; description?: string }
  | { kind: 'lightningAddress'; raw: string }
  | { kind: 'lnurlPay'; raw: string }
  | { kind: 'bitcoinAddress'; raw: string }
  | { kind: 'sparkAddress'; raw: string }
  | { kind: 'unknown'; raw: string };

export interface WalletProvider {
  readonly kind: 'nwc' | 'breez-spark';
  capabilities(): WalletCapabilities;
  /** Human name of the underlying wallet, when the provider can know it. */
  info(): Promise<{ alias?: string }>;
  balance(): Promise<WalletBalance>;
  /** Create a bolt11 invoice to RECEIVE `sats` (0 = any-amount invoice). */
  receive(sats: number, description?: string): Promise<WalletInvoice>;
  /**
   * A static receive address to share with a counterparty, if the provider
   * has one (Spark address for breez-spark, lud16 for NWC). Null otherwise.
   */
  address(): Promise<string | null>;
  /**
   * Pay a bolt11 invoice, lightning address or Spark address. `sats` is
   * required for address destinations (they carry no amount); for bolt11 the
   * invoice amount wins. Resolves once the wallet reports success.
   */
  pay(destination: string, sats?: number): Promise<{ preimage?: string }>;
  /** Recent transactions, newest first. Empty if unsupported. */
  transactions(limit?: number): Promise<WalletTx[]>;
  /** Classify a Send destination. Falls back to local heuristics (NWC). */
  parse(input: string): Promise<ParsedDest>;
  /** BTC price in `usd` per BTC, or null when the provider has no rate feed. */
  usdRate(): Promise<number | null>;
  /** A fresh on-chain deposit address, or null when unsupported (NWC). */
  receiveOnchain(): Promise<string | null>;
  /** Tear down sockets/subscriptions. */
  close(): void;
}
