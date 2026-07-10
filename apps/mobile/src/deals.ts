/**
 * Pure deal/negotiation helpers shared by the Messages UI. Kept out of App.tsx
 * so they are unit-testable without the React Native runtime.
 */
import type { Intent, Negotiation } from '@freeport/protocol';
import type { MobileClient } from './client';

/**
 * A negotiation is "done" (shown under Messages > Completed) when it was
 * cancelled/expired, or confirmed and the deal has completed.
 */
export function negoIsDone(n: Negotiation): boolean {
  if (n.state === 'cancelled' || n.state === 'expired') return true;
  if (n.state === 'confirmed') return n.stage === 'completed';
  return false;
}

/**
 * Which Messages sub-tab to open given new activity since `sinceTs`: the sub-tab
 * of the most recent UNREAD inbound chat message (or just-confirmed deal), or
 * null when nothing is newer than `sinceTs` — so a manual sub-tab choice stands.
 */
export function messagesViewForNewActivity(
  negos: Negotiation[],
  sinceTs: number,
): 'active' | 'completed' | null {
  let bestTs = sinceTs;
  let bestView: 'active' | 'completed' | null = null;
  for (const n of negos) {
    for (const m of n.messages ?? []) {
      if (m.dir === 'in' && m.ts > bestTs) { bestTs = m.ts; bestView = negoIsDone(n) ? 'completed' : 'active'; }
    }
    if (n.state === 'confirmed' && n.updatedAt > bestTs) { bestTs = n.updatedAt; bestView = negoIsDone(n) ? 'completed' : 'active'; }
  }
  return bestView;
}

/**
 * "My offer is out, the poster hasn't responded yet." These cards previously
 * rendered NOTHING below the title (no status, no chat, no cancel) and read as
 * broken next to accepted deals with their waiting banner (user report).
 */
export function isPendingOffer(n: Pick<Negotiation, 'state' | 'termsBy'>): boolean {
  return n.state === 'open' && n.termsBy === 'us';
}

/** One-line summary of the terms I offered — "150.000₫ · 12:45" — for the
 *  pending-offer banner. Empty when the offer changed nothing concrete
 *  (flexible time, no price). Time formatting is injected (fmtClock lives in
 *  the UI layer). */
export function offerSummary(
  terms: { payment?: string; window?: { start: number } } | undefined,
  fmtTime: (d: Date) => string,
): string {
  if (!terms) return '';
  const parts: string[] = [];
  if (terms.payment) parts.push(terms.payment);
  if (terms.window?.start) parts.push(fmtTime(new Date(terms.window.start * 1000)));
  return parts.join(' · ');
}

/**
 * Contact-handshake healing. A confirmed deal is only mutual once BOTH sides
 * hold each other's contact; a single lost accept DM (signer hiccup, relay
 * drop) stranded deals at "waiting for the other party to come online" forever
 * (field report). Two self-healing moves, both idempotent for the peer:
 */

/** We received their contact but never (successfully) sent ours → send it. */
export function needsContactBackflow(n: Pick<Negotiation, 'state' | 'theirContact' | 'ourContact'>): boolean {
  return n.state === 'confirmed' && !!n.theirContact && !n.ourContact;
}

/** We sent ours but theirs never arrived and the deal has sat stuck for a
 *  while → re-send our accept as a poke. The peer either applies it (they
 *  never got it) or, on the duplicate, re-sends their own contact. The grace
 *  period avoids poking during the normal seconds-long handshake. */
export function shouldPokeForContact(
  n: Pick<Negotiation, 'state' | 'theirContact' | 'ourContact' | 'updatedAt'>,
  nowSec: number,
  graceSec = 60,
): boolean {
  return n.state === 'confirmed' && !!n.ourContact && !n.theirContact && nowSec - n.updatedAt > graceSec;
}

/**
 * Lowercased haystack for keyword search over a post: title, author name, route
 * (from/to), service, location, notes, payment, category, subcategory.
 */
export function searchableText(i: Intent, client: MobileClient | null): string {
  const p = i.content.payload as Record<string, any>;
  const author = client?.profiles.get(i.pubkey)?.name ?? '';
  return [
    i.content.title, author, p.from?.name, p.to?.name, p.service,
    p.location?.name, p.notes, p.payment, p.category, p.subcategory,
  ].filter(Boolean).join(' ').toLowerCase();
}
