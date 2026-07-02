/**
 * Optional WRITE surface: let an agent publish a Freeport intent (offer/request).
 *
 * Off unless ENABLE_WRITE=1. Two signing modes:
 *   - secretKey: the agent hands over an nsec/hex key; we build + sign + publish.
 *     Convenient for LLM agents that can't sign. The key is used transiently and
 *     never logged or stored. Use a DEDICATED agent key, not a personal one.
 *   - event: the agent passes an already-signed intent event; we only validate +
 *     publish (no key ever touches the server).
 *
 * Anti-spam: a strict per-pubkey token bucket plus a server-wide global bucket,
 * on top of the HTTP per-IP limits. Only Freeport intent kinds (32101/32102) are
 * accepted, with a bounded expiry, so the endpoint can't be a generic relay-spam
 * proxy.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Event } from 'nostr-tools';
import { getPublicKey, verifyEvent } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import {
  KIND_INTENT_OFFER,
  KIND_INTENT_REQUEST,
  buildIntentEvent,
  geohashPrefixes,
  parseIntentEvent,
  type BuildIntentInput,
} from '@freeport/protocol';
import type { RelayPool } from './pool.js';
import { sanitizeRelays } from './relays.js';

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

const num = (name: string, def: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
};

// ── Rate limiting (token buckets, in-memory) ────────────────────────────────
const PER_PUBKEY_PER_MIN = num('WRITE_PER_MIN', 5);
const GLOBAL_PER_MIN = num('WRITE_GLOBAL_PER_MIN', 60);
const MAX_EXPIRY_DAYS = num('WRITE_MAX_EXPIRY_DAYS', 30);

interface Bucket { tokens: number; updated: number }
const perPubkey = new Map<string, Bucket>();
const global: Bucket = { tokens: GLOBAL_PER_MIN, updated: Date.now() };

function take(bucket: Bucket, ratePerMin: number, cap: number): boolean {
  const now = Date.now();
  bucket.tokens = Math.min(cap, bucket.tokens + ((now - bucket.updated) / 60000) * ratePerMin);
  bucket.updated = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/** Allow a write for this pubkey? Consumes a token from both buckets. */
function allow(pubkey: string): { ok: true } | { ok: false; reason: string } {
  if (!take(global, GLOBAL_PER_MIN, GLOBAL_PER_MIN)) {
    return { ok: false, reason: 'Server write rate limit reached — try again shortly.' };
  }
  let b = perPubkey.get(pubkey);
  if (!b) { b = { tokens: PER_PUBKEY_PER_MIN, updated: Date.now() }; perPubkey.set(pubkey, b); }
  if (!take(b, PER_PUBKEY_PER_MIN, PER_PUBKEY_PER_MIN)) {
    return { ok: false, reason: `Per-key write rate limit reached (${PER_PUBKEY_PER_MIN}/min).` };
  }
  if (perPubkey.size > 5000) { // bound memory
    for (const k of perPubkey.keys()) { perPubkey.delete(k); if (perPubkey.size <= 4000) break; }
  }
  return { ok: true };
}

/** Decode an nsec or 64-char hex secret to bytes. Throws on anything else. */
function decodeSecret(secret: string): Uint8Array {
  const s = secret.trim();
  if (s.startsWith('nsec1')) {
    const d = nip19.decode(s);
    if (d.type !== 'nsec') throw new Error('Not an nsec key.');
    return d.data as Uint8Array;
  }
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  }
  throw new Error('secretKey must be an nsec or 64-char hex private key.');
}

/** Max serialized size for a pre-signed event (relays commonly cap ~64-128KB). */
const MAX_EVENT_BYTES = 64 * 1024;
/** How far in the future a created_at may claim to be (clock skew allowance). */
const MAX_FUTURE_SKEW_SECONDS = 15 * 60;

/**
 * Enforce the tool's documented invariants on a pre-signed event — build mode
 * gets them for free from buildIntentEvent + zod, this path must check them
 * explicitly. Returns an error string, or null when the event is acceptable.
 */
export function validatePreSigned(ev: Event): string | null {
  if (JSON.stringify(ev).length > MAX_EVENT_BYTES) {
    return `event too large (max ${MAX_EVENT_BYTES / 1024}KB).`;
  }
  const now = Math.floor(Date.now() / 1000);
  if (ev.created_at > now + MAX_FUTURE_SKEW_SECONDS) {
    return 'event.created_at is in the future.';
  }
  if (!parseIntentEvent(ev)) {
    return 'event is not a valid Freeport intent (content shape / d tag / kind-side mismatch).';
  }
  const expTag = ev.tags.find((t) => t[0] === 'expiration')?.[1];
  const exp = Number(expTag);
  if (!expTag || !Number.isFinite(exp)) {
    return 'event must carry a NIP-40 expiration tag.';
  }
  if (exp <= now) return 'event is already expired.';
  if (exp > now + MAX_EXPIRY_DAYS * 24 * 3600) {
    return `expiration exceeds the ${MAX_EXPIRY_DAYS}-day maximum.`;
  }
  return null;
}

export function registerWriteTools(server: McpServer, pool: RelayPool): void {
  server.tool(
    'freeport_create_post',
    'Publish a Freeport intent — an OFFER (side "offer": driver/provider/seller) or a REQUEST ' +
      '(side "request": rider/buyer). Provide EITHER a `secretKey` (nsec or hex — the server builds, ' +
      'signs and publishes; use a DEDICATED agent key, never a personal one — it is used once and never ' +
      'stored) OR a pre-signed `event` (you sign locally; nothing secret reaches the server). ' +
      'Strict rate limits apply. Returns the published event id + addressable `d`.',
    {
      // Build mode (with secretKey):
      secretKey: z.string().optional().describe('nsec or 64-hex private key. Used transiently to sign; never stored. Omit if passing a pre-signed `event`.'),
      side: z.enum(['offer', 'request']).optional().describe('offer = provider/seller/driver; request = buyer/rider.'),
      market: z.string().optional().describe('Market key, e.g. "rideshare" or "service".'),
      schema: z.string().optional().describe('Payload schema, e.g. "rideshare/1" or "service/1".'),
      title: z.string().max(200).optional(),
      payload: z.record(z.string(), z.unknown()).optional().describe('Intent payload (from/to/location, payment, etc.) per the freeport://protocol resource.'),
      expiresInMinutes: z.number().int().min(5).max(MAX_EXPIRY_DAYS * 24 * 60).optional()
        .describe(`How long the post stays live (default 720). Max ${MAX_EXPIRY_DAYS} days.`),
      window: z.object({ start: z.number().int(), end: z.number().int() }).optional(),
      geohashes: z.array(z.string()).max(8).optional().describe('Geohashes for location-scoped discovery. Each is expanded into all its prefixes (precision 1-6) so radius searches at any precision match.'),
      topics: z.array(z.string()).max(8).optional().describe('Topic `t` tags (area/category), e.g. ["vn_hanoi","vn_hanoi_ridesharing"].'),
      d: z.string().optional().describe('Stable id to republish/replace an existing post; defaults to random.'),
      // Pre-signed mode:
      event: z.any().optional().describe('A complete, signed Nostr event (kind 32101/32102). Use instead of secretKey to keep keys off the server.'),
      relays: z.array(z.string()).max(10).optional(),
    },
    async (args) => {
      const relays = sanitizeRelays(args.relays);
      let event: Event;

      if (args.event) {
        event = args.event as Event;
        if (event.kind !== KIND_INTENT_OFFER && event.kind !== KIND_INTENT_REQUEST) {
          return json({ ok: false, error: 'event.kind must be 32101 (offer) or 32102 (request).' });
        }
        let valid = false;
        try { valid = verifyEvent(event); } catch { valid = false; }
        if (!valid) return json({ ok: false, error: 'event signature is invalid.' });
        // The pre-signed path must uphold the SAME anti-spam guarantees as
        // build mode, or it's a generic relay-spam proxy for anyone who signs
        // locally: a well-formed intent body, a bounded NIP-40 expiry, and a
        // sane timestamp/size.
        const err = validatePreSigned(event);
        if (err) return json({ ok: false, error: err });
      } else {
        if (!args.secretKey) return json({ ok: false, error: 'Provide either secretKey (+ fields) or a signed event.' });
        if (!args.side || !args.market || !args.schema || !args.title || !args.payload) {
          return json({ ok: false, error: 'side, market, schema, title and payload are required when using secretKey.' });
        }
        let sk: Uint8Array;
        try { sk = decodeSecret(args.secretKey); } catch (e) { return json({ ok: false, error: (e as Error).message }); }
        const expiresAt = Math.floor(Date.now() / 1000) + (args.expiresInMinutes ?? 720) * 60;
        const input: BuildIntentInput = {
          side: args.side, market: args.market, schema: args.schema, title: args.title,
          payload: args.payload as Record<string, unknown>, expiresAt,
          window: args.window,
          // Relay #g filters are exact-match — expand each geohash into its
          // prefixes so covers at any precision (1-6) find this intent.
          geohashes: args.geohashes ? [...new Set(args.geohashes.flatMap((g) => geohashPrefixes(g)))] : undefined,
          topics: args.topics, d: args.d,
        };
        event = buildIntentEvent(input, sk);
      }

      const gate = allow(event.pubkey);
      if (!gate.ok) return json({ ok: false, error: gate.reason });

      try {
        const { ok, failed } = await pool.publish(event, relays);
        const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
        return json({
          ok: true, id: event.id, d: dTag, kind: event.kind, pubkey: event.pubkey,
          createdAt: event.created_at, publishedTo: ok, failedRelays: failed,
        });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message });
      }
    },
  );
}
