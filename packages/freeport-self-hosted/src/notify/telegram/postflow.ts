/**
 * Publish a guest's ride request on their behalf: screen for prohibited content,
 * enforce quotas + the shared write rate-limit, mine NIP-13 PoW (anti-spam,
 * matching the app), sign with the guest's key, publish, and register the intent
 * on the guest's agent so inbound offers open negotiations correctly.
 */
import { finalizeEvent } from 'nostr-tools/pure';
import { minePow } from 'nostr-tools/nip13';
import {
  buildIntentTemplate, parseIntentEvent, geohashPrefixes, screenIntentContent,
  DEMO_MARKET, DEMO_SCHEMA, type Intent,
} from '@freeport/protocol';
import type { RelayPool } from '../../pool.js';
import { allowWrite } from '../../write.js';
import type { GuestStore, GuestRecord } from './guests.js';
import { parseWhen, type RideDraft } from './conversation.js';
import type { GeoPoint } from './geocode.js';

export interface PublishDeps {
  pool: RelayPool;
  relays?: string[];
  guests: GuestStore;
  powBits: number;
  rideExpiryMin: number;
  maxPerDay: number;
  maxActive: number;
}

export type PublishResult = { ok: true; intent: Intent } | { ok: false; error: string };

export async function publishGuestRide(deps: PublishDeps, guest: GuestRecord, draft: RideDraft, from: GeoPoint, to: GeoPoint): Promise<PublishResult> {
  const title = `Ride: ${from.name} → ${to.name}`;
  const payload = {
    from: { name: from.name, geohash: from.geohash },
    to: { name: to.name, geohash: to.geohash },
    seats: 1,
    ...(draft.payment ? { payment: draft.payment } : {}),
  };

  const verdict = screenIntentContent(DEMO_SCHEMA, title, payload);
  if (!verdict.allowed) return { ok: false, error: verdict.reason ?? 'That post isn’t allowed.' };

  const quota = deps.guests.quotaReason(guest.telegramUserId, deps.maxPerDay, deps.maxActive);
  if (quota) return { ok: false, error: quota };

  const now = Math.floor(Date.now() / 1000);
  const tmpl = buildIntentTemplate({
    side: 'request', market: DEMO_MARKET, schema: DEMO_SCHEMA, title, payload,
    window: parseWhen(draft.when),
    expiresAt: now + deps.rideExpiryMin * 60,
    geohashes: geohashPrefixes(from.geohash),
    topics: [DEMO_MARKET],
  });

  // Mine PoW into the template (with the guest's pubkey) before signing, so the
  // published id carries the difficulty — then sign with the decrypted key.
  const sk = deps.guests.decryptKey(guest);
  let ev;
  try {
    let mined: any = { ...tmpl, pubkey: guest.pubkey };
    try { mined = minePow(mined, deps.powBits); } catch { /* best-effort — publish unmined */ }
    ev = finalizeEvent({ kind: mined.kind, created_at: mined.created_at, tags: mined.tags, content: mined.content }, sk);
  } finally {
    sk.fill(0);
  }

  const gate = allowWrite(ev.pubkey);
  if (!gate.ok) return { ok: false, error: gate.reason };

  const intent = parseIntentEvent(ev);
  if (!intent) return { ok: false, error: 'Built an invalid intent.' };
  try {
    await deps.pool.publish(ev, deps.relays);
  } catch {
    return { ok: false, error: 'Couldn’t reach any relay — try again.' };
  }
  deps.guests.addPost(guest.telegramUserId, {
    d: intent.d, eventId: intent.id, market: intent.content.market, schema: intent.content.schema,
    title, createdAt: intent.createdAt, expiresAt: intent.content.expires_at, status: 'live',
    intentJson: JSON.stringify(intent),
  });
  return { ok: true, intent };
}

const WITHDRAW_TTL_SEC = 600;

/** Withdraw a guest's live post: republish the same d-tag with an empty payload
 *  (short future expiry) so relays replace it and clients drop it from the feed. */
export async function withdrawGuestPost(deps: PublishDeps, guest: GuestRecord, d: string): Promise<boolean> {
  const post = guest.posts.find((p) => p.d === d && p.status === 'live');
  if (!post) return false;
  const now = Math.floor(Date.now() / 1000);
  const tmpl = buildIntentTemplate({
    side: post.schema.startsWith('service') ? 'offer' : 'request', // side is preserved from the original in a full impl; requests here
    market: post.market, schema: post.schema, title: '(withdrawn)', payload: {},
    expiresAt: now + WITHDRAW_TTL_SEC, d, createdAt: now,
  });
  const sk = deps.guests.decryptKey(guest);
  let ev;
  try { ev = finalizeEvent({ kind: tmpl.kind, created_at: tmpl.created_at, tags: tmpl.tags, content: tmpl.content }, sk); }
  finally { sk.fill(0); }
  try { await deps.pool.publish(ev, deps.relays); } catch { return false; }
  deps.guests.setPostStatus(guest.telegramUserId, d, 'withdrawn');
  return true;
}
