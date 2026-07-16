/* eslint-disable @typescript-eslint/no-explicit-any -- uniffi/WASM dual-dialect SDK enums are opaque, deliberately untyped shapes */
/**
 * The two Breez SDK builds speak different dialects for the SAME API:
 *
 *  - WASM (web): serde-style plain tagged objects — `{ type: 'bolt11Invoice', … }`.
 *  - React Native (uniffi): UniffiEnum CLASS INSTANCES with a PascalCase `tag`
 *    and positional `inner` fields. Feeding it a plain `{type: …}` object hits
 *    the converter's default branch: UnexpectedEnumCase — surfaced to users as
 *    "Raw enum value doesn't match any cases" (Receive → Bitcoin/Spark tabs).
 *
 * Every enum crossing the SDK boundary goes through these builders. `M` is the
 * native module namespace (holds the generated enum classes) — null on web.
 * Scalar widths differ too: uniffi wants BigInt for u64/u128 fields.
 */

export function bolt11ReceiveMethod(M: any | null, sats: number, description: string, opts?: { paymentHash?: string; expirySecs?: number }): any {
  const amount = Math.max(0, Math.round(sats));
  const expirySecs = opts?.expirySecs ?? 3600;
  if (!M) return { type: 'bolt11Invoice', description, amountSats: amount, expirySecs, ...(opts?.paymentHash ? { paymentHash: opts.paymentHash } : {}) };
  return new M.ReceivePaymentMethod.Bolt11Invoice({
    description,
    amountSats: BigInt(amount),
    expirySecs,
    paymentHash: opts?.paymentHash,
  });
}

export function sparkAddressMethod(M: any | null): any {
  return M ? new M.ReceivePaymentMethod.SparkAddress() : { type: 'sparkAddress' };
}

export function bitcoinAddressMethod(M: any | null): any {
  return M ? new M.ReceivePaymentMethod.BitcoinAddress({ newAddress: undefined }) : { type: 'bitcoinAddress' };
}

export function sparkInvoiceMethod(M: any | null, tokenIdentifier: string, baseUnits: bigint, description?: string): any {
  if (!M) {
    return { type: 'sparkInvoice', tokenIdentifier, amount: baseUnits.toString(), ...(description ? { description } : {}) };
  }
  return new M.ReceivePaymentMethod.SparkInvoice({
    amount: baseUnits,
    tokenIdentifier,
    expiryTime: undefined,
    description,
    senderPublicKey: undefined,
  });
}

export function inputPaymentRequest(M: any | null, input: string): any {
  return M ? new M.PaymentRequest.Input({ input }) : { type: 'input', input };
}

export function bolt11SendOptions(M: any | null): any {
  const fields = { preferSpark: false, completionTimeoutSecs: 30 };
  return M ? new M.SendPaymentOptions.Bolt11Invoice(fields) : { type: 'bolt11Invoice', ...fields };
}

/** PaymentStatus is a string on WASM ('failed') and a NUMERIC enum on native
 *  (PaymentStatus.Failed === 2). */
export function paymentFailed(status: unknown): boolean {
  return status === 'failed' || status === 'Failed' || status === 2;
}

/** Variant name of a parsed/tagged SDK value, lowercased: WASM `type`
 *  ('bolt11Invoice') or uniffi `tag` ('Bolt11Invoice') → 'bolt11invoice'. */
export function variantOf(x: any): string {
  return String(x?.type ?? x?.tag ?? '').toLowerCase();
}

/** Variant payload: uniffi stores it positionally in `inner[0]`; WASM inlines
 *  the fields on the object itself. */
export function variantDetails(x: any): any {
  return Array.isArray(x?.inner) ? x.inner[0] : x;
}
