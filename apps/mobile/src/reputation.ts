/**
 * Reputation — trust-weighted aggregation of karma + deal receipts.
 *
 * Headline metric is DISTINCT PROVEN PARTNERS, not a rating sum — exactly the
 * quantity that is expensive to fake under the receipt-pair + WoT model.
 *
 * Counting rules:
 * - A karma event counts if the rater is the counterparty of that deal AND
 *   either side published a receipt for it:
 *     · bilateral (both halves signed) → full weight, and the deal also counts
 *       toward distinct-partner metrics.
 *     · unilateral (only the rater signed their half) → reduced weight and
 *       marked disputed; it does NOT inflate partner/deal counts. This closes
 *       the MIA loophole: a no-show never counter-signs their receipt, so
 *       requiring a full pair would let them dodge the rater's negative karma.
 *       Grief-resistant because a unilateral claim from an unknown key carries
 *       ~ε weight (UNKNOWN_RATER_WEIGHT × DISPUTED_WEIGHT) — only a trusted,
 *       in-network counterparty's unilateral report meaningfully moves a score.
 * - Repeated ratings from the same rater decay 1, ½, ¼ … (distinct partners
 *   are what matter, not volume from one friend).
 * - Rater influence is multiplied by their web-of-trust weight from the
 *   viewer (unknown raters get a token baseline so a global view still
 *   renders, but they can't move the needle).
 * - Reciprocal-only dampener: a rater whose entire receipt history is deals
 *   with this one subject gets halved (classic two-puppet pattern).
 * - New-account flag: no kind:0/1 event older than 7 days anywhere.
 */
import type { SimplePool } from 'nostr-tools/pool';
import type { Event } from 'nostr-tools/pure';
import { KIND_DEAL_RECEIPT, KIND_KARMA } from '@freeport/protocol';
import { query, tagVal } from './query';
import { provenDeals, parseReceipt } from './receipts';
import { karmaLabel, type KarmaEvent } from './karma';
import { maskPhone } from './profile';

export interface Reputation {
  deals: number;             // proven (reciprocal-receipt) deals
  partners: number;          // distinct counterparties across those deals
  partnersInNetwork: number; // partners within the viewer's trust map
  verifiedBy: number;        // distinct partners who attested contact_verified
  score: number;             // trust-weighted average karma (-1..2)
  ratingCount: number;       // valid ratings counted
  newAccount: boolean;       // no activity older than NEW_ACCOUNT_DAYS
  label: string;
}

const NEW_ACCOUNT_DAYS = 7;

/**
 * Normalize a (possibly masked) phone for comparison: unify mask chars to •
 * and re-mask full numbers, so "+1xxxxxx6789", "+1••••••6789" and the full
 * "+15551234567" all reduce to the same canonical string.
 */
function canonicalMask(phone: string): string {
  const p = phone.replace(/[\s.-]/g, '').replace(/[xX*]/g, '•');
  return p.includes('•') ? p : maskPhone(p);
}
/** Influence floor for raters outside the viewer's network. */
const UNKNOWN_RATER_WEIGHT = 0.05;
const RECIPROCAL_ONLY_PENALTY = 0.5;
/** Weight multiplier for a unilateral (only-rater-signed) rating, e.g. a no-show report. */
const DISPUTED_WEIGHT = 0.5;
const MAX_PARTNERS_CHECKED = 50;
const IN_NETWORK_THRESHOLD = 0.1;

export async function fetchReputation(
  pool: SimplePool,
  relays: string[],
  subject: string,
  trust: Map<string, number> | null,
): Promise<Reputation> {
  const now = Math.floor(Date.now() / 1000);
  const [authored, tagged, karmaEvents, oldActivity, profileEvents] = await Promise.all([
    query(pool, relays, { kinds: [KIND_DEAL_RECEIPT], authors: [subject], limit: 200 }),
    query(pool, relays, { kinds: [KIND_DEAL_RECEIPT], '#p': [subject], limit: 200 }),
    query(pool, relays, { kinds: [KIND_KARMA], '#p': [subject], limit: 500 }),
    query(pool, relays, {
      kinds: [0, 1],
      authors: [subject],
      until: now - NEW_ACCOUNT_DAYS * 86400,
      limit: 1,
    }),
    query(pool, relays, { kinds: [0], authors: [subject], limit: 1 }),
  ]);

  // Subject's published phone mask, for cross-checking rater attestations
  let subjectMask: string | null = null;
  const profileEv = profileEvents.sort((a, b) => b.created_at - a.created_at)[0];
  if (profileEv) {
    try {
      const meta = JSON.parse(profileEv.content);
      if (typeof meta.phone === 'string' && meta.phone) subjectMask = canonicalMask(meta.phone);
    } catch { /* ignore */ }
  }

  // Proven deals: negoId → counterparty (both halves signed). Drives the
  // expensive-to-fake partner/deal metrics.
  const deals = provenDeals([...authored, ...tagged], subject);
  const partners = new Set(deals.values());

  // Receipts where someone published THEIR half naming the subject (R→S).
  // Lets a counterparty's karma count even if the subject (a no-show) never
  // counter-signed. Keyed `rater|negoId`.
  const raterHalf = new Set<string>();
  for (const ev of tagged) {
    const r = parseReceipt(ev);
    if (r && r.peer === subject) raterHalf.add(`${r.author}|${r.negoId}`);
  }

  // Reciprocal-only dampener: how many distinct peers does each partner have?
  const partnerList = [...partners].slice(0, MAX_PARTNERS_CHECKED);
  const partnerReceipts = partnerList.length
    ? await query(pool, relays, { kinds: [KIND_DEAL_RECEIPT], authors: partnerList, limit: 500 })
    : [];
  const peersOf = new Map<string, Set<string>>();
  for (const ev of partnerReceipts) {
    const r = parseReceipt(ev);
    if (!r) continue;
    if (!peersOf.has(r.author)) peersOf.set(r.author, new Set());
    peersOf.get(r.author)!.add(r.peer);
  }

  // Latest karma per (rater, nego) — addressable events replace older ones
  const latest = new Map<string, Event>();
  for (const ev of karmaEvents) {
    const d = tagVal(ev, 'd') ?? '';
    const k = `${ev.pubkey}|${d}`;
    const prev = latest.get(k);
    if (!prev || prev.created_at < ev.created_at) latest.set(k, ev);
  }

  // Group valid ratings by rater. A rating counts when the rater is the deal's
  // counterparty and a receipt backs it — bilateral (full) or unilateral
  // (rater-signed only → disputed, reduced weight).
  const byRater = new Map<string, { ev: Event; disputed: boolean }[]>();
  for (const ev of latest.values()) {
    const d = tagVal(ev, 'd') ?? '';
    const bilateral = deals.get(d) === ev.pubkey;
    const unilateral = !bilateral && raterHalf.has(`${ev.pubkey}|${d}`);
    if (!bilateral && !unilateral) continue;
    if (!byRater.has(ev.pubkey)) byRater.set(ev.pubkey, []);
    byRater.get(ev.pubkey)!.push({ ev, disputed: unilateral });
  }

  let weightedSum = 0;
  let weightTotal = 0;
  let ratingCount = 0;
  const verifiedBy = new Set<string>();
  for (const [rater, items] of byRater) {
    let raterWeight = trust?.get(rater) ?? UNKNOWN_RATER_WEIGHT;
    const raterPeers = peersOf.get(rater);
    if (raterPeers && raterPeers.size <= 1) raterWeight *= RECIPROCAL_ONLY_PENALTY;
    items.sort((a, b) => a.ev.created_at - b.ev.created_at);
    items.forEach(({ ev, disputed }, i) => {
      let content: KarmaEvent;
      try { content = JSON.parse(ev.content); } catch { return; }
      if (typeof content.score !== 'number' || content.score < -1 || content.score > 2) return;
      let w = raterWeight * Math.pow(0.5, i); // repeat-rater decay
      if (disputed) w *= DISPUTED_WEIGHT;      // unilateral (no-show) → reduced
      weightedSum += w * content.score;
      weightTotal += w;
      ratingCount++;
      if (content.contact_verified && !disputed) {
        // Cross-check: the number the rater actually reached must match the
        // subject's published mask. A mismatch means the public mask is fake
        // — discard the attestation. No published phone or no attested mask
        // → benefit of the doubt ("reachable" is still worth something).
        // Skipped for disputed ratings — a no-show wasn't reachable anyway.
        const attested = content.contact_masked ? canonicalMask(content.contact_masked) : null;
        if (!attested || !subjectMask || attested === subjectMask) verifiedBy.add(rater);
      }
    });
  }

  const partnersInNetwork = [...partners].filter(
    (p) => (trust?.get(p) ?? 0) >= IN_NETWORK_THRESHOLD,
  ).length;
  const score = weightTotal > 0 ? weightedSum / weightTotal : 0;

  return {
    deals: deals.size,
    partners: partners.size,
    partnersInNetwork,
    verifiedBy: verifiedBy.size,
    score,
    ratingCount,
    newAccount: oldActivity.length === 0,
    label: karmaLabel(score, ratingCount),
  };
}
