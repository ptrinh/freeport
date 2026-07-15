/**
 * LNURL-pay resolution for lightning addresses (user@domain, LUD-16).
 * Lets an NWC wallet (bolt11-only) pay a counterparty who shared a lightning
 * address: resolve → request an invoice for the exact amount → verify the
 * bolt11 actually carries that amount → hand it to the wallet.
 */
import { bolt11Sats } from './bolt11';

export function isLightningAddress(s: string): boolean {
  return /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test((s || '').trim());
}

export async function lnurlPayInvoice(address: string, sats: number): Promise<string> {
  const [name, domain] = address.trim().split('@');
  const msat = Math.round(sats) * 1000;
  const metaResp = await fetch(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`);
  if (!metaResp.ok) throw new Error('lnurl-unreachable');
  const meta = await metaResp.json();
  if (meta?.tag !== 'payRequest' || !meta.callback) throw new Error('lnurl-bad-response');
  // Callback is chosen by the untrusted server — require https so it can't
  // downgrade us to a MITM-able invoice fetch.
  if (!/^https:\/\//i.test(String(meta.callback))) throw new Error('lnurl-bad-response');
  if ((meta.minSendable && msat < meta.minSendable) || (meta.maxSendable && msat > meta.maxSendable)) {
    throw new Error('lnurl-amount-out-of-range');
  }
  const sep = String(meta.callback).includes('?') ? '&' : '?';
  const invResp = await fetch(`${meta.callback}${sep}amount=${msat}`);
  if (!invResp.ok) throw new Error('lnurl-unreachable');
  const inv = await invResp.json();
  if (!inv?.pr) throw new Error(inv?.reason || 'lnurl-bad-response');
  // The endpoint chose the invoice — never trust it with the amount.
  if (bolt11Sats(inv.pr) !== Math.round(sats)) throw new Error('lnurl-amount-mismatch');
  return inv.pr as string;
}
