/**
 * Zaps (NIP-57) — tip sats to a post or its author over the lightning
 * address already in their kind:0 (`lud16`). The receiver's LNURL server
 * (breez.tips for Freeport wallets — verified: allowsNostr + nostrPubkey)
 * signs and publishes the kind-9735 zap receipt, so totals are verifiable
 * by anyone; we only build the kind-9734 request and pay the invoice.
 */
import type { Event } from 'nostr-tools/pure';
import type { Signer } from './signer';

export interface LnurlPayInfo {
  callback: string;
  minSendable: number; // msats
  maxSendable: number; // msats
  allowsNostr?: boolean;
  nostrPubkey?: string;
}

export async function resolveLnurlPay(lud16: string): Promise<LnurlPayInfo | null> {
  const [user, domain] = lud16.split('@');
  if (!user || !domain) return null;
  try {
    const r = await fetch(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`);
    const j = await r.json();
    if (j?.tag !== 'payRequest' || typeof j.callback !== 'string') return null;
    return j as LnurlPayInfo;
  } catch {
    return null; // offline / no such user / not an lnurl server
  }
}

/**
 * Build the zap invoice: kind-9734 request (when the server supports zaps —
 * otherwise it degrades to a plain lnurl-pay tip) → callback → bolt11.
 * Returns null when the address doesn't resolve or the amount is out of range.
 */
export async function zapInvoice(
  signer: Signer,
  opts: { lud16: string; toPubkey: string; eventId?: string; amountSat: number; relays: string[]; comment?: string },
): Promise<{ pr: string; zap: boolean } | null> {
  const info = await resolveLnurlPay(opts.lud16);
  if (!info) return null;
  const msats = Math.round(opts.amountSat * 1000);
  if (msats < (info.minSendable ?? 1) || msats > (info.maxSendable ?? Infinity)) return null;
  let nostrParam = '';
  const zap = !!(info.allowsNostr && info.nostrPubkey);
  if (zap) {
    const zapReq = await signer.signEvent({
      kind: 9734,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['relays', ...opts.relays],
        ['amount', String(msats)],
        ['p', opts.toPubkey],
        ...(opts.eventId ? [['e', opts.eventId]] : []),
      ],
      content: opts.comment ?? '',
    });
    nostrParam = `&nostr=${encodeURIComponent(JSON.stringify(zapReq))}`;
  }
  try {
    const sep = info.callback.includes('?') ? '&' : '?';
    const r = await fetch(`${info.callback}${sep}amount=${msats}${nostrParam}`);
    const j = await r.json();
    return typeof j?.pr === 'string' && j.pr ? { pr: j.pr, zap } : null;
  } catch {
    return null;
  }
}

/** Sats from a kind-9735 receipt: the amount lives in the embedded 9734. */
export function receiptSats(ev: Event): number {
  try {
    const desc = ev.tags.find((t) => t[0] === 'description')?.[1];
    if (!desc) return 0;
    const req = JSON.parse(desc);
    const msats = Number(req?.tags?.find((t: string[]) => t[0] === 'amount')?.[1]);
    return Number.isFinite(msats) ? Math.floor(msats / 1000) : 0;
  } catch {
    return 0;
  }
}

/**
 * Batched zap totals for a set of event ids (Browse cards). One REQ; totals
 * update once on EOSE. Receipts are deduped by event id across relays.
 */
export function fetchZapTotals(
  pool: { subscribeMany: (relays: string[], filter: any, handlers: any) => { close: () => void } },
  relays: string[],
  eventIds: string[],
  cb: (totals: Map<string, number>) => void,
): () => void {
  if (!eventIds.length) return () => {};
  const totals = new Map<string, number>();
  const seen = new Set<string>();
  const sub = pool.subscribeMany(
    relays,
    { kinds: [9735], '#e': eventIds },
    {
      onevent: (ev: Event) => {
        if (seen.has(ev.id)) return;
        seen.add(ev.id);
        const target = ev.tags.find((t) => t[0] === 'e')?.[1];
        const sats = receiptSats(ev);
        if (target && sats > 0) totals.set(target, (totals.get(target) ?? 0) + sats);
      },
      oneose: () => {
        cb(totals);
        sub.close();
      },
    },
  );
  return () => sub.close();
}
