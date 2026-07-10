/**
 * MCP resources — let an agent self-onboard without guessing: the active relay
 * set and a compact protocol/taxonomy reference. Read-only static resources.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  KIND_INTENT_OFFER, KIND_INTENT_REQUEST, KIND_KARMA, KIND_DEAL_RECEIPT,
} from '@freeport/protocol';
import type { RelayPool } from './pool.js';

const PROTOCOL_GUIDE = `# Freeport on Nostr — agent guide

Decentralized P2P marketplace: rideshare, local services, goods. No central
server; identities are Nostr keypairs; listings are public addressable events;
deals are negotiated over encrypted DMs; reputation is a web-of-trust graph.

## Event kinds
- ${KIND_INTENT_OFFER} — OFFER (driver / provider / seller).
- ${KIND_INTENT_REQUEST} — REQUEST (rider / buyer).
- ${KIND_KARMA} — karma rating for a completed deal (score -1/0/1/2; d=deal id, p=ratee).
- ${KIND_DEAL_RECEIPT} — deal receipt; a deal is "proven" only when BOTH halves exist (A→B and B→A).
- 4 — NIP-04 encrypted DM carrying negotiation envelopes (NOT readable here).

## Intent content (JSON)
{ v, side: "offer"|"request", market, schema, title, payload, window?: {start,end}, expires_at }
- payload is vertical-specific: rideshare/1 → {from:{name,geohash}, to:{name,geohash}, seats?, ...};
  service/1 → {location:{name,geohash}, service, category?, subcategory?, ...}.
- expires_at uses NIP-40; expired intents are filtered out by nostr_search_intents.

## Discovery tags
- t (topic): area_category_subcategory, slugified. e.g. "vn_hanoi", "vn_hanoi_ridesharing",
  "vn_hanoi_ridesharing_compactcar". Relays filter server-side by #t — pass these as \`topics\`.
- g (geohash): proximity. Pass a point + radius via \`near\` to nostr_search_intents; it refines
  distance client-side and sorts nearest-first.

## How to use the tools
- Browse demand near a point: nostr_search_intents { side:"request", near:{lat,lon,radiusKm}, topics:["vn_hanoi_ridesharing"] }.
- Vet a counterparty before trusting: nostr_search_reputation { pubkey }.
- Discover valid topics: query broadly by kind, then read the t tags on returned events.

This server is read-only. Posting/negotiating requires the agent's own Nostr signer (out of scope here).`;

export function registerResources(server: McpServer, pool: RelayPool): void {
  server.resource(
    'relays',
    'freeport://relays',
    { description: 'The Nostr relays this server queries.', mimeType: 'application/json' },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(pool.relays, null, 2) }],
    }),
  );

  server.resource(
    'protocol',
    'freeport://protocol',
    { description: 'Freeport event kinds, intent schema, discovery tags, and tool usage.', mimeType: 'text/markdown' },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: PROTOCOL_GUIDE }],
    }),
  );
}
