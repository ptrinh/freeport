/**
 * The agent-facing tool surface. Read-only queries over Freeport's public
 * addressable events; results are decoded into structured JSON (parsed tags,
 * computed distance, human-friendly fields) so an agent never parses raw
 * Nostr tag arrays. NIP-04 DMs are encrypted and intentionally out of scope.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Event, Filter } from 'nostr-tools';
import {
  KIND_INTENT_OFFER,
  KIND_INTENT_REQUEST,
  parseIntentEvent,
} from '@freeport/protocol';
import type { RelayPool } from './pool.js';
import { distanceKmToGeohash, geohashesCovering } from './geo.js';
import { sanitizeRelays } from './relays.js';
import { fetchReputationSummary } from './reputation.js';

const KIND_PROFILE = 0; // NIP-01 metadata

/** Shared zod field: optional per-call relay override. */
const relaysField = z.array(z.string()).max(10).optional()
  .describe('Override the relay set for this call (ws/wss URLs, max 10). Defaults to the server relays.');

const tagVal = (ev: Event, name: string): string | undefined =>
  ev.tags.find((t) => t[0] === name)?.[1];
const tagVals = (ev: Event, name: string): string[] =>
  ev.tags.filter((t) => t[0] === name).map((t) => t[1]).filter(Boolean);

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

/**
 * Collapse addressable events to the LATEST version per (kind, pubkey, d).
 * Different relays hold different versions of the same replaceable event, so
 * a raw multi-relay query returns duplicates: an edited intent listed twice,
 * a withdrawn intent's pre-withdraw version shown as live, duplicate receipt
 * halves double-counting proven deals.
 */
export function latestByAddress(events: Event[]): Event[] {
  const best = new Map<string, Event>();
  for (const ev of events) {
    const key = `${ev.kind}:${ev.pubkey}:${tagVal(ev, 'd') ?? ''}`;
    const cur = best.get(key);
    if (!cur || ev.created_at > cur.created_at) best.set(key, ev);
  }
  return [...best.values()];
}

/** Best geohash for an intent: the published `g` tag, else the payload pin. */
function intentGeohash(ev: Event, payload: { from?: { geohash?: string }; location?: { geohash?: string }; geohash?: string }): string | undefined {
  return (
    tagVal(ev, 'g') ||
    payload?.from?.geohash ||
    payload?.location?.geohash ||
    undefined
  );
}

export function registerTools(server: McpServer, pool: RelayPool): void {
  // ── nostr_search_intents ────────────────────────────────────────────────
  server.tool(
    'nostr_search_intents',
    'Search Freeport ride/service/product intents (offers & requests). Filter by ' +
      'side, category/area topic tags, and an optional geographic radius. Results are ' +
      'decoded, expiry-filtered, and sorted nearest-first when a point is given.',
    {
      side: z.enum(['offer', 'request', 'any']).default('any')
        .describe('offer = drivers/providers/sellers; request = riders/buyers; any = both'),
      topics: z.array(z.string()).optional()
        .describe('Topic `t` tags to require (category/subcategory/area keys, e.g. "vn_hanoi", "ridesharing").'),
      near: z.object({
        lat: z.number(), lon: z.number(),
        radiusKm: z.number().positive().max(20000).default(100),
      }).optional().describe('Filter & sort by distance from this point.'),
      relaySideGeohash: z.boolean().default(false)
        .describe('Also narrow at the relay via a #g cover of the radius. Only effective if posts carry geohash-prefix tags; off by default.'),
      since: z.number().int().optional().describe('Only events created at/after this unix-seconds time.'),
      until: z.number().int().optional().describe('Only events created at/before this unix-seconds time.'),
      includeExpired: z.boolean().default(false),
      limit: z.number().int().min(1).max(500).default(200),
      relays: relaysField,
    },
    async (args) => {
      const relays = sanitizeRelays(args.relays);
      const kinds =
        args.side === 'offer' ? [KIND_INTENT_OFFER]
        : args.side === 'request' ? [KIND_INTENT_REQUEST]
        : [KIND_INTENT_OFFER, KIND_INTENT_REQUEST];
      const filter: Filter = { kinds, limit: args.limit };
      if (args.topics?.length) filter['#t'] = args.topics;
      if (args.since) filter.since = args.since;
      if (args.until) filter.until = args.until;
      if (args.relaySideGeohash && args.near) {
        filter['#g'] = geohashesCovering(args.near.lat, args.near.lon, args.near.radiusKm);
      }

      const events = latestByAddress(await pool.query(filter, relays));
      const now = Math.floor(Date.now() / 1000);
      const rows = events
        .map((ev) => {
          const intent = parseIntentEvent(ev);
          if (!intent) return null;
          const payload = intent.content.payload as { withdrawn?: boolean; from?: { geohash?: string; name?: string }; to?: { name?: string }; location?: { geohash?: string; name?: string }; payment?: string; service?: string; [k: string]: unknown };
          // Withdrawal tombstone (latest version has an empty payload) — the
          // listing is gone; don't surface it.
          if (!payload || Object.keys(payload).length === 0) return null;
          const geohash = intentGeohash(ev, payload);
          const distanceKm = args.near && geohash
            ? distanceKmToGeohash(args.near.lat, args.near.lon, geohash)
            : null;
          return {
            id: intent.id,
            d: intent.d,
            pubkey: intent.pubkey,
            side: intent.content.side,
            market: intent.content.market,
            schema: intent.content.schema,
            title: intent.content.title,
            payload,
            window: intent.content.window,
            geohash,
            distanceKm: distanceKm === null ? null : Math.round(distanceKm * 10) / 10,
            topics: tagVals(ev, 't'),
            createdAt: intent.createdAt,
            expiresAt: intent.content.expires_at,
            expired: intent.content.expires_at <= now,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .filter((r) => args.includeExpired || !r.expired)
        .filter((r) => !(args.near && r.distanceKm !== null && r.distanceKm > args.near.radiusKm))
        .sort((a, b) =>
          args.near
            ? (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)
            : b.createdAt - a.createdAt,
        );

      return json({ count: rows.length, scanned: events.length, intents: rows });
    },
  );

  // ── nostr_search_reputation ─────────────────────────────────────────────
  server.tool(
    'nostr_search_reputation',
    'Fetch reputation signals for a pubkey: karma ratings (kind 32103) it received ' +
      'and deal receipts (kind 32104). Returns proven-deal count (both receipt halves ' +
      'present) and a karma summary. Note: scores are subjective and un-weighted here; ' +
      'do not treat as Sybil-proof.',
    {
      pubkey: z.string().describe('Subject pubkey (hex) to look up reputation for.'),
      limit: z.number().int().min(1).max(1000).default(500),
      relays: relaysField,
    },
    async (args) => json(await fetchReputationSummary(pool, sanitizeRelays(args.relays), args.pubkey, args.limit)),
  );

  // ── nostr_get_event ─────────────────────────────────────────────────────
  server.tool(
    'nostr_get_event',
    'Fetch one or more events by id. Returns the raw signed events.',
    { ids: z.array(z.string()).min(1).max(50), relays: relaysField },
    async (args) => json({ events: await pool.query({ ids: args.ids, limit: args.ids.length }, sanitizeRelays(args.relays)) }),
  );

  // ── nostr_profile ───────────────────────────────────────────────────────
  server.tool(
    'nostr_profile',
    'Fetch NIP-01 profile metadata (kind 0) for one or more pubkeys — name, about, ' +
      'picture, nip05, lud16, etc. Optionally include each author\'s most recent notes (kind 1). ' +
      'General-purpose: works for any Nostr user, not just Freeport.',
    {
      pubkeys: z.array(z.string()).min(1).max(20).describe('Hex pubkeys to fetch profiles for.'),
      recentNotes: z.number().int().min(0).max(20).default(0)
        .describe('If >0, also fetch up to this many recent text notes (kind 1) per pubkey.'),
      relays: relaysField,
    },
    async (args) => {
      const relays = sanitizeRelays(args.relays);
      const metaEvents = await pool.query({ kinds: [KIND_PROFILE], authors: args.pubkeys, limit: args.pubkeys.length * 2 }, relays);
      // Latest kind-0 per author.
      const latest = new Map<string, Event>();
      for (const ev of metaEvents) {
        const cur = latest.get(ev.pubkey);
        if (!cur || ev.created_at > cur.created_at) latest.set(ev.pubkey, ev);
      }
      const notesByAuthor = new Map<string, Event[]>();
      if (args.recentNotes > 0) {
        const noteEvents = await pool.query(
          { kinds: [1], authors: args.pubkeys, limit: args.pubkeys.length * args.recentNotes * 2 },
          relays,
        );
        for (const ev of noteEvents.sort((a, b) => b.created_at - a.created_at)) {
          const arr = notesByAuthor.get(ev.pubkey) ?? [];
          if (arr.length < args.recentNotes) { arr.push(ev); notesByAuthor.set(ev.pubkey, arr); }
        }
      }
      const profiles = args.pubkeys.map((pk) => {
        const ev = latest.get(pk);
        let metadata: Record<string, unknown> | null = null;
        if (ev) { try { metadata = JSON.parse(ev.content); } catch { metadata = null; } }
        return {
          pubkey: pk,
          found: !!ev,
          metadata,
          updatedAt: ev?.created_at ?? null,
          recentNotes: (notesByAuthor.get(pk) ?? []).map((n) => ({ id: n.id, content: n.content, createdAt: n.created_at })),
        };
      });
      return json({ profiles });
    },
  );

  // ── nostr_query_raw ─────────────────────────────────────────────────────
  server.tool(
    'nostr_query_raw',
    'Escape hatch: run an arbitrary NIP-01 filter (kinds/authors/ids/tags/since/until/limit). ' +
      'Use the typed tools above when they fit. Returns raw signed events.',
    {
      kinds: z.array(z.number().int()).optional(),
      authors: z.array(z.string()).optional(),
      ids: z.array(z.string()).optional(),
      tags: z.record(z.string(), z.array(z.string())).optional()
        .describe('Tag filters, e.g. {"t":["vn_hanoi"],"g":["w3gv"]}. Keys are single tag letters.'),
      since: z.number().int().optional(),
      until: z.number().int().optional(),
      limit: z.number().int().min(1).max(500).default(100),
      relays: relaysField,
    },
    async (args) => {
      const filter: Filter = { limit: args.limit };
      if (args.kinds) filter.kinds = args.kinds;
      if (args.authors) filter.authors = args.authors;
      if (args.ids) filter.ids = args.ids;
      if (args.since) filter.since = args.since;
      if (args.until) filter.until = args.until;
      for (const [k, v] of Object.entries(args.tags ?? {})) filter[`#${k}`] = v;
      return json({ events: await pool.query(filter, sanitizeRelays(args.relays)) });
    },
  );
}
