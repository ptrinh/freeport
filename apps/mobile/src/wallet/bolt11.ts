/**
 * Minimal bolt11 amount decoder — no signature/tag parsing, just the
 * human-readable part. Used to sanity-check that an invoice we're about to
 * pay carries exactly the amount the user agreed to (a malicious LNURL
 * endpoint could otherwise hand back an inflated invoice that an NWC wallet
 * would pay silently).
 */
export function bolt11Sats(invoice: string): number | null {
  const m = (invoice || '').trim().toLowerCase().match(/^ln(?:bc|tbs|tb|bcrt)(\d+)([munp])?1/);
  if (!m) return null;
  const digits = BigInt(m[1]);
  // Amount is in BTC scaled by the multiplier; work in millisats to stay integral.
  const msatPerBtc = 100_000_000_000n;
  let msat: bigint;
  switch (m[2]) {
    case undefined: msat = digits * msatPerBtc; break;
    case 'm': msat = digits * (msatPerBtc / 1_000n); break;
    case 'u': msat = digits * (msatPerBtc / 1_000_000n); break;
    case 'n': msat = digits * (msatPerBtc / 1_000_000_000n); break;
    case 'p': msat = (digits * msatPerBtc) / 1_000_000_000_000n; break;
    default: return null;
  }
  if (msat <= 0n || msat % 1000n !== 0n) return null; // sub-sat → reject
  const sats = msat / 1000n;
  return sats <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(sats) : null;
}
