/**
 * Reputation summary for a pubkey — karma ratings (kind 32103) received + deal
 * receipts (kind 32104) to compute a proven-deal count and karma average.
 * Extracted from the nostr_search_reputation MCP tool so the Telegram guest
 * bridge can show the same signal on an offer card without duplicating queries.
 *
 * Note: scores are subjective and un-weighted here — not Sybil-proof (a fresh
 * keypair is free). Treat zero-history counterparties with visible caution.
 */
import type { Event } from 'nostr-tools';
import { KIND_KARMA, KIND_DEAL_RECEIPT } from '@freeport/protocol';
import type { RelayPool } from './pool.js';

export interface ReputationSummary {
  pubkey: string;
  provenDeals: number;
  karma: { count: number; average: number; ratings: { from: string; deal?: string; score?: number; note?: string; createdAt: number }[] };
}

const tag = (ev: Event, name: string): string | undefined => ev.tags.find((t) => t[0] === name)?.[1];

/** Latest event per (kind, pubkey, d) — collapse relay-replicated replaceables. */
function latestByAddress(events: Event[]): Event[] {
  const best = new Map<string, Event>();
  for (const ev of events) {
    const key = `${ev.kind}:${ev.pubkey}:${tag(ev, 'd') ?? ''}`;
    const cur = best.get(key);
    if (!cur || ev.created_at > cur.created_at) best.set(key, ev);
  }
  return [...best.values()];
}

export async function fetchReputationSummary(pool: RelayPool, relays: string[] | undefined, pubkey: string, limit = 500): Promise<ReputationSummary> {
  const [karma, received, authored] = (await Promise.all([
    pool.query({ kinds: [KIND_KARMA], '#p': [pubkey], limit }, relays),
    pool.query({ kinds: [KIND_DEAL_RECEIPT], '#p': [pubkey], limit }, relays),
    pool.query({ kinds: [KIND_DEAL_RECEIPT], authors: [pubkey], limit }, relays),
  ])).map(latestByAddress);

  // Proven deals: the subject authored a receipt whose reciprocal half exists.
  const half = new Set<string>();
  for (const ev of [...received, ...authored]) {
    const d = tag(ev, 'd'); const p = tag(ev, 'p');
    if (d && p) half.add(`${d}|${ev.pubkey}|${p}`);
  }
  let proven = 0;
  for (const ev of authored) {
    const d = tag(ev, 'd'); const p = tag(ev, 'p');
    if (d && p && half.has(`${d}|${p}|${pubkey}`)) proven++;
  }

  const ratings = karma.map((ev) => {
    let score: number | undefined, note: string | undefined;
    try { const c = JSON.parse(ev.content); score = c.score; note = c.note; } catch { /* skip */ }
    return { from: ev.pubkey, deal: tag(ev, 'd'), score, note, createdAt: ev.created_at };
  }).filter((r) => typeof r.score === 'number');

  const count = ratings.length;
  const avg = count ? ratings.reduce((s, r) => s + (r.score as number), 0) / count : 0;
  return { pubkey, provenDeals: proven, karma: { count, average: Math.round(avg * 100) / 100, ratings } };
}
