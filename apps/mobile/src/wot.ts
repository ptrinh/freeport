/**
 * Web of Trust — per-viewer trust map over the deal-receipt graph.
 *
 * Sybil resistance without staking: there is no global score. Each viewer
 * computes rater weights from THEIR OWN vantage point by walking the proven
 * deal-receipt graph (kind:32104 pairs) outward from their key:
 *
 *   hop 0  people the viewer completed deals with        weight 1.0
 *   hop 1  their verified counterparties                 weight 0.3
 *   hop 2  one ring further                              weight 0.1
 *   unreachable                                          weight ~0
 *
 * NIP-02 follows seed the map too (weight 0.3) so users with no deal history
 * yet still get a usable graph. A cluster of self-rating sock puppets has no
 * proven-deal path into any real viewer's network, so its ratings carry no
 * weight no matter how many events it publishes.
 */
import type { SimplePool } from 'nostr-tools/pool';
import { KIND_DEAL_RECEIPT } from '@freeport/protocol';
import { query, tagVal } from './query';
import { parseReceipt, receiptKey } from './receipts';

const HOP_WEIGHTS = [1.0, 0.3, 0.1];
const FOLLOW_WEIGHT = 0.3;
const MAX_FRONTIER = 200;

export async function buildTrustMap(
  pool: SimplePool,
  relays: string[],
  viewer: string,
): Promise<Map<string, number>> {
  const trust = new Map<string, number>();

  // Seed from NIP-02 follow list — bootstrap for users with no deals yet
  const contactLists = await query(pool, relays, { kinds: [3], authors: [viewer], limit: 1 });
  const latest = contactLists.sort((a, b) => b.created_at - a.created_at)[0];
  if (latest) {
    for (const t of latest.tags) {
      if (t[0] === 'p' && t[1] && t[1] !== viewer) trust.set(t[1], FOLLOW_WEIGHT);
    }
  }

  // BFS over proven deal edges
  let frontier = [viewer];
  const visited = new Set([viewer]);
  for (const weight of HOP_WEIGHTS) {
    const partners = await confirmedPartners(pool, relays, frontier);
    const next: string[] = [];
    for (const p of partners) {
      if (visited.has(p)) continue;
      visited.add(p);
      if ((trust.get(p) ?? 0) < weight) trust.set(p, weight);
      next.push(p);
    }
    frontier = next.slice(0, MAX_FRONTIER);
    if (frontier.length === 0) break;
  }
  return trust;
}

/** Pubkeys with a PROVEN (reciprocal-receipt) deal with any member of `members`. */
async function confirmedPartners(
  pool: SimplePool,
  relays: string[],
  members: string[],
): Promise<Set<string>> {
  const [authored, tagged] = await Promise.all([
    query(pool, relays, { kinds: [KIND_DEAL_RECEIPT], authors: members, limit: 500 }),
    query(pool, relays, { kinds: [KIND_DEAL_RECEIPT], '#p': members, limit: 500 }),
  ]);
  const all = [...authored, ...tagged];
  const have = new Set<string>();
  for (const ev of all) {
    const r = parseReceipt(ev);
    if (r) have.add(receiptKey(r.negoId, r.author, r.peer));
  }
  const memberSet = new Set(members);
  const partners = new Set<string>();
  for (const ev of all) {
    const d = tagVal(ev, 'd');
    const p = tagVal(ev, 'p');
    if (!d || !p) continue;
    if (!have.has(receiptKey(d, p, ev.pubkey))) continue; // need the reciprocal half
    if (memberSet.has(ev.pubkey)) partners.add(p);
    if (memberSet.has(p)) partners.add(ev.pubkey);
  }
  return partners;
}
