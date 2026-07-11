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

export interface TokenBalanceInfo {
  /** Spark token identifier (metadata.identifier). */
  id: string;
  ticker: string;
  name: string;
  decimals: number;
  /** Human units (base units / 10^decimals). */
  amount: number;
}

export interface WalletTx {
  direction: 'in' | 'out';
  sats: number;
  /** Present when this was a token (stablecoin) payment — amount in human
   *  units; `sats` is 0 in that case. */
  token?: { ticker: string; amount: number };
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
  /** BTC price in the given fiat (ISO code, e.g. 'USD', 'VND') per BTC, or
   *  null when the provider has no rate feed or doesn't know the coin. */
  fiatRate(coin: string): Promise<number | null>;
  /** A fresh on-chain deposit address, or null when unsupported (NWC). */
  receiveOnchain(): Promise<string | null>;
  /** Stablecoin balances (Spark tokens). Empty for providers without them. */
  tokenBalances(): Promise<TokenBalanceInfo[]>;
  /** Spark invoice to RECEIVE `amount` (human units) of a token. */
  receiveToken?(token: TokenBalanceInfo, amount: number | string, description?: string): Promise<WalletInvoice>;
  /** Pay a Spark destination in a token instead of sats. */
  payToken?(destination: string, token: TokenBalanceInfo, amount: number | string): Promise<{ preimage?: string }>;
  /** Registered lightning address (user@domain), when the provider supports it. */
  lightningAddress?(): Promise<{ address: string; lnurl?: string } | null>;
  /** Claim a username under the app's lightning-address domain. */
  registerLightningAddress?(username: string): Promise<{ address: string; lnurl?: string }>;
  /** True when the username is still free. */
  checkUsername?(username: string): Promise<boolean>;
  /** Tear down sockets/subscriptions. */
  close(): void;
}
