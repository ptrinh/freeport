/**
 * Deal receipts — Freeport kind:32104.
 *
 * When a negotiation reaches `confirmed`, each side publishes its own half:
 * d-tag = nego-id, p-tag = counterparty. A deal is PROVEN only when both
 * halves exist (A→B and B→A for the same d), so a single key cannot
 * fabricate a deal by itself — it needs a counterparty key, which pushes
 * the forgery into the web-of-trust graph where isolated clusters are
 * visible and weightless.
 */
import { type Event } from 'nostr-tools/pure';
import type { SimplePool } from 'nostr-tools/pool';
import { KIND_DEAL_RECEIPT, SCHEMA_VERSION } from '@freeport/protocol';
import { tagVal } from './query';
import type { Signer } from './signer';

export interface DealReceipt {
  negoId: string;
  author: string; // who signed this half
  peer: string;   // who they claim to have dealt with
  createdAt: number;
}

export async function publishReceipt(
  pool: SimplePool,
  signer: Signer,
  negoId: string,
  peer: string,
  intentId: string,
  relays: string[],
): Promise<void> {
  const ev = await signer.signEvent({
    kind: KIND_DEAL_RECEIPT,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', negoId],
      ['p', peer],
    ],
    content: JSON.stringify({ v: SCHEMA_VERSION, intent_id: intentId }),
  });
  await Promise.any(pool.publish(relays, ev));
}

export function parseReceipt(ev: Event): DealReceipt | null {
  const negoId = tagVal(ev, 'd');
  const peer = tagVal(ev, 'p');
  if (!negoId || !peer) return null;
  return { negoId, author: ev.pubkey, peer, createdAt: ev.created_at };
}

/** Key identifying one half of a receipt pair. */
export function receiptKey(negoId: string, author: string, peer: string): string {
  return `${negoId}|${author}|${peer}`;
}

/**
 * From a mixed bag of receipt events, return proven deals: negoId → peer map
 * for `subject`, counting only receipts whose reciprocal half is present.
 */
export function provenDeals(events: Event[], subject: string): Map<string, string> {
  const have = new Set<string>();
  const parsed: DealReceipt[] = [];
  for (const ev of events) {
    const r = parseReceipt(ev);
    if (!r) continue;
    parsed.push(r);
    have.add(receiptKey(r.negoId, r.author, r.peer));
  }
  const deals = new Map<string, string>();
  for (const r of parsed) {
    if (r.author !== subject) continue;
    if (have.has(receiptKey(r.negoId, r.peer, r.author))) deals.set(r.negoId, r.peer);
  }
  return deals;
}
