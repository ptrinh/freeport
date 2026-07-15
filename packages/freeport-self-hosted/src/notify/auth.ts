/**
 * Proof-of-pubkey-ownership for /subscribe (NIP-98 style).
 *
 * Watching a pubkey for inbound DMs leaks metadata (that DMs arrive, and when)
 * to whoever holds the push endpoint. So a subscribe that sets `pubkey` must
 * prove control of that key: the client signs a short-lived kind-27235 event
 * binding the watched pubkey (event.pubkey), the push transport key (`u` tag —
 * the Web Push endpoint URL or Expo push token, i.e. where the metadata will be
 * delivered), and a recent timestamp (created_at). The server verifies:
 *
 *   - the signature is BY the watched pubkey,
 *   - created_at is within ±AUTH_MAX_SKEW_SEC of now,
 *   - the `u` tag matches THIS request's transport key.
 *
 * A captured proof is therefore useless for enrolling a different endpoint,
 * and goes stale in minutes.
 */
import { verifyEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools';

/** NIP-98 HTTP-auth event kind, reused for this purpose-specific proof. */
export const AUTH_KIND = 27235;
/** Accepted clock skew, seconds (±5 min). */
export const AUTH_MAX_SKEW_SEC = 300;

export type AuthResult = { ok: true } | { ok: false; reason: string };

/**
 * Verify a subscribe proof.
 *
 * @param auth        the signed Nostr event sent by the client (untrusted).
 * @param pubkey      the pubkey the subscription wants to watch (hex).
 * @param transportKey the push transport key of THIS request — the Web Push
 *                     endpoint URL or the Expo push token.
 */
export function verifySubscribeAuth(auth: unknown, pubkey: string, transportKey: string, nowSec = Math.floor(Date.now() / 1000)): AuthResult {
  const ev = auth as Event;
  if (!ev || typeof ev !== 'object' || typeof ev.sig !== 'string' || typeof ev.pubkey !== 'string' || !Array.isArray(ev.tags)) {
    return { ok: false, reason: 'auth must be a signed nostr event' };
  }
  if (ev.kind !== AUTH_KIND) return { ok: false, reason: `auth event kind must be ${AUTH_KIND}` };
  if (ev.pubkey !== pubkey) return { ok: false, reason: 'auth event must be signed by the watched pubkey' };
  const ts = typeof ev.created_at === 'number' ? ev.created_at : NaN;
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > AUTH_MAX_SKEW_SEC) {
    return { ok: false, reason: `auth event created_at outside ±${AUTH_MAX_SKEW_SEC}s window` };
  }
  const u = ev.tags.find((t) => Array.isArray(t) && t[0] === 'u')?.[1];
  if (u !== transportKey) return { ok: false, reason: 'auth event u tag must match the push endpoint / token' };
  let valid = false;
  // Rebuild a clean event object: nostr-tools caches "already verified" under a
  // symbol key that survives object spread — a decorated event must not skip
  // the actual signature check. (HTTP JSON input never carries it; belt+braces.)
  const clean: Event = { id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, tags: ev.tags, content: ev.content, sig: ev.sig };
  try { valid = verifyEvent(clean); } catch { valid = false; }
  if (!valid) return { ok: false, reason: 'auth event signature invalid' };
  return { ok: true };
}
