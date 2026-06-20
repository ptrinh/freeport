/**
 * Karma ratings — Freeport kind:32103.
 *
 * After a confirmed deal, either party can rate the other with a score of
 * -1 (bad), 0 (neutral), 1 (good), or 2 (excellent). Each rater can only
 * rate a given deal once (addressable by (pubkey, kind, nego-id d-tag)).
 *
 * Anti-cheat measures baked into the event:
 * - `contact_verified`: the rater attests they actually reached the peer at
 *   their listed phone number (peer phone verification — no central verifier).
 * - NIP-13 proof-of-work: a small CPU cost floor so mass-producing karma
 *   events is mildly expensive. Not Sybil-proof on its own — just a spam floor.
 *
 * Aggregation/weighting lives in reputation.ts: ratings only count against a
 * proven deal receipt pair, repeated raters decay, and rater influence is
 * weighted by web-of-trust distance from the viewer.
 */
import { minePowAsync } from './pow';
import type { SimplePool } from 'nostr-tools/pool';
import type { Signer } from './signer';
import { KIND_KARMA, SCHEMA_VERSION } from '@freeport/protocol';
import { t } from './i18n';

export type KarmaScore = -1 | 0 | 1 | 2;

export interface KarmaEvent {
  v: number;
  score: KarmaScore;
  note?: string;
  /** Rater attests they reached the peer at their listed phone number. */
  contact_verified?: boolean;
  /**
   * Masked form of the number the rater ACTUALLY reached (taken from the
   * contact exchanged via encrypted DM, not from the peer's public profile).
   * Readers cross-check this against the peer's published phone mask — a
   * mismatch means the public mask is fake, and the attestation is discarded.
   */
  contact_masked?: string;
}

/** CPU-cost floor per karma event (leading zero bits of the event id). */
const POW_DIFFICULTY = 8;

export function karmaLabel(avg: number, count: number): string {
  if (count === 0) return t('No ratings');
  if (avg >= 1.5) return t('⭐⭐ Excellent');
  if (avg >= 0.8) return t('⭐ Good');
  if (avg >= 0) return t('Neutral');
  return t('⚠️ Poor');
}

/**
 * Publish a karma rating for a deal.
 * d-tag = negoId so the rater can only publish one rating per deal.
 */
export async function publishKarma(
  pool: SimplePool,
  signer: Signer,
  ratee: string,
  score: KarmaScore,
  negoId: string,
  note: string | undefined,
  contactVerified: boolean,
  contactMasked: string | undefined,
  relays: string[],
): Promise<void> {
  const content: KarmaEvent = { v: SCHEMA_VERSION, score };
  if (note) content.note = note;
  if (contactVerified) content.contact_verified = true;
  if (contactVerified && contactMasked) content.contact_masked = contactMasked;
  let template: any = {
    kind: KIND_KARMA,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', negoId],
      ['p', ratee],
    ],
    content: JSON.stringify(content),
    pubkey: signer.pubkey,
  };
  try {
    template = await minePowAsync(template, POW_DIFFICULTY);
  } catch {
    // PoW is best-effort; an unmined event is still valid, just lower-trust
  }
  const ev = await signer.signEvent({
    kind: template.kind,
    created_at: template.created_at,
    tags: template.tags,
    content: template.content,
  });
  await Promise.any(pool.publish(relays, ev));
}
