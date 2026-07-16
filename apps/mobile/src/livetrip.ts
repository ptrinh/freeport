/**
 * Tier-2 live trip sharing over Nostr — no server.
 *
 * The rider generates a throwaway keypair per shared trip and publishes their
 * GPS as an ADDRESSABLE event (kind 30420, d=session id) so relays keep only
 * the latest position — a viewer opening the link sees the current location
 * immediately, then live updates. The location JSON is encrypted (NIP-04, self)
 * with the throwaway key, so only someone with the key can read it (relays
 * can't). An `expiration` tag (NIP-40) lets relays drop it after the window.
 *
 * The share link is short: it carries ONLY the 32-byte secret key
 * (`<origin>/#t=<base64url>`). The public key, the addressable `d` id and the
 * relay list are all derived/hardcoded on the viewer side, and the static trip
 * info (from/to/driver/vehicle) travels inside the encrypted event — so it
 * stays private too, and never bloats the URL. A hash route keeps the static
 * host serving index.html so the app can branch to the viewer on web.
 */
import type { SimplePool } from 'nostr-tools/pool';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import * as nip04 from 'nostr-tools/nip04';

export const TRIP_KIND = 30420;
// Hardcoded on both sides so the relay list never has to ride in the link.
const TRIP_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom', 'wss://relay.nostr.band'];
const TTL_SECONDS = 3 * 3600; // relays may drop the location after this

export interface TripStatic {
  from: string;
  to: string;
  driver?: string;        // driver name
  phone?: string;         // driver phone
  vehicleModel?: string;  // e.g. "Toyota Vios — white"
  plateNumber?: string;   // licence plate
  passenger?: string;     // passenger name
  vehicle?: string;       // generic category fallback (e.g. "Motorbike")
}
export interface TripLoc { lat: number; lon: number; ts: number; status?: 'live' | 'ended' }
/** What the rider actually encrypts each tick: position + (repeated) static info. */
export interface TripUpdate extends TripLoc { info?: TripStatic }

/** Rider-side handle (kept in memory while sharing). */
export interface TripSession { sk: Uint8Array; pk: string; id: string; info: TripStatic }
/** Viewer-side handle, fully reconstructed from the link's secret key. */
export interface TripView { sk: Uint8Array; pk: string; id: string; relays: string[] }

// ── base64url over raw bytes (no btoa/atob; works on web + Hermes) ──────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function b64FromBytes(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const b0 = b[i], b1 = b[i + 1] ?? 0, b2 = b[i + 2] ?? 0;
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < b.length) out += B64[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < b.length) out += B64[b2 & 63];
  }
  return out;
}
function b64ToBytes(str: string): Uint8Array {
  const lut: Record<string, number> = {};
  for (let i = 0; i < B64.length; i++) lut[B64[i]] = i;
  const bytes: number[] = [];
  let buf = 0, bits = 0;
  for (const ch of str) {
    const v = lut[ch];
    if (v === undefined) continue;
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buf >> bits) & 0xff); }
  }
  return new Uint8Array(bytes);
}

/** Generate a throwaway session for a trip. */
export function createTripSession(info: TripStatic): TripSession {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  return { sk, pk, id: pk.slice(0, 16), info };
}

/** Short share link — carries only the secret key (~43 chars after `#t=`). */
export function tripLink(session: TripSession, origin: string): string {
  return `${origin.replace(/\/$/, '')}/#t=${b64FromBytes(session.sk)}`;
}

/** The session's base64url secret — persist this to reuse the SAME link/key
 *  across app restarts so a shared link never goes stale. */
export function tripSecret(session: TripSession): string {
  return b64FromBytes(session.sk);
}

/** Rebuild a session from a persisted secret (see `tripSecret`). */
export function restoreTripSession(secretB64: string, info: TripStatic): TripSession | null {
  try {
    const sk = b64ToBytes(secretB64);
    if (sk.length !== 32) return null;
    const pk = getPublicKey(sk);
    return { sk, pk, id: pk.slice(0, 16), info };
  } catch { return null; }
}

/** Parse a viewer URL hash like "#t=…" → reconstruct the full view, or null. */
export function decodeTripHash(hash: string): TripView | null {
  const m = /#t=([A-Za-z0-9\-_]+)/.exec(hash || '');
  if (!m) return null;
  try {
    const sk = b64ToBytes(m[1]);
    if (sk.length !== 32) return null;
    const pk = getPublicKey(sk);
    return { sk, pk, id: pk.slice(0, 16), relays: TRIP_RELAYS };
  } catch { return null; }
}

/** Publish (or refresh) the rider's current encrypted location + trip info. */
export async function publishTripLocation(pool: SimplePool, session: TripSession, loc: TripLoc): Promise<void> {
  const update: TripUpdate = { ...loc, info: session.info };
  const content = await nip04.encrypt(session.sk, session.pk, JSON.stringify(update));
  const now = Math.floor(Date.now() / 1000);
  const evt = finalizeEvent({
    kind: TRIP_KIND,
    created_at: now,
    tags: [['d', session.id], ['expiration', String(now + TTL_SECONDS)]],
    content,
  }, session.sk);
  try { await Promise.any(pool.publish(TRIP_RELAYS, evt)); } catch { /* best-effort */ }
}

/** Viewer side: subscribe to the rider's updates, decrypting each. */
export function subscribeTrip(pool: SimplePool, view: TripView, onUpdate: (u: TripUpdate) => void): () => void {
  // Multiple relays + async decrypt deliver updates in arbitrary order: an
  // older position arriving after a fresh one would snap the marker backwards,
  // and a replayed `live` after `ended` would resurrect a finished trip.
  // Only ever move FORWARD in the sender's own timeline.
  let latestTs = 0;
  const sub = pool.subscribeMany(
    view.relays,
    { kinds: [TRIP_KIND], authors: [view.pk], '#d': [view.id] },
    {
      onevent: async (ev: { content: string; created_at: number }) => {
        try {
          const u = JSON.parse(await nip04.decrypt(view.sk, view.pk, ev.content));
          if (typeof u?.lat !== 'number' || typeof u?.lon !== 'number') return;
          const ts = typeof u.ts === 'number' ? u.ts : 0;
          if (ts < latestTs) return; // stale — a newer update already applied
          latestTs = ts;
          onUpdate(u);
        } catch { /* not ours / undecryptable */ }
      },
    },
  );
  return () => sub.close();
}
