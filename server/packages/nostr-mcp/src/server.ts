/**
 * Server factory. Builds an McpServer wired to a shared RelayPool. Both the
 * stdio entry (self-host / registry) and the HTTP entry (hosted endpoint) use
 * this — the SAME pool instance is shared across all HTTP requests so relay
 * sockets and the query cache are process-wide, not per connection.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DEFAULT_RELAYS } from '@freeport/protocol';
import { RelayPool } from './pool.js';
import { registerTools } from './tools.js';
import { registerWriteTools } from './write.js';
import { registerResources } from './resources.js';

export const NAME = 'freeport-nostr';
export const VERSION = '0.6.2';

/** Whether the optional write tool (freeport_create_post) is enabled. */
export const WRITE_ENABLED = process.env.ENABLE_WRITE === '1';

/** Shown to agents on connect — orients them before any tool call. */
export const INSTRUCTIONS =
  'Freeport is a decentralized peer-to-peer marketplace on Nostr (rideshare, local services, goods). ' +
  'Use nostr_search_intents to find offers (kind 32101: drivers/providers/sellers) and requests ' +
  '(kind 32102: riders/buyers) by side, topic tag, and geographic radius; nostr_search_reputation for a ' +
  "pubkey's karma + proven deals; nostr_profile for kind-0 metadata; nostr_query_raw for any NIP-01 filter. " +
  'Topic tags shard by area_category_subcategory (e.g. "vn_hanoi", "vn_hanoi_ridesharing"). ' +
  (WRITE_ENABLED
    ? 'You can publish a post with freeport_create_post (offer/request) — provide a dedicated agent secretKey or a pre-signed event; strict rate limits apply. '
    : 'This server is READ-ONLY for queries. ') +
  'It never reads encrypted DMs. Read the freeport://protocol resource for ' +
  'the full event schema and the freeport://relays resource for the active relay set.';

/** Relays from FREEPORT_RELAYS (comma-separated) or the protocol defaults. */
export function relaysFromEnv(): string[] {
  const env = process.env.FREEPORT_RELAYS?.split(',').map((s) => s.trim()).filter(Boolean);
  return env?.length ? env : [...DEFAULT_RELAYS];
}

/** One shared pool for the whole process. */
export const sharedPool = new RelayPool(relaysFromEnv());

export function createServer(pool: RelayPool = sharedPool): McpServer {
  const server = new McpServer({ name: NAME, version: VERSION }, { instructions: INSTRUCTIONS });
  registerTools(server, pool);
  if (WRITE_ENABLED) registerWriteTools(server, pool);
  registerResources(server, pool);
  return server;
}
