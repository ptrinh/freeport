/**
 * All naming lives here. Trademark/domain check for "Freeport" is still
 * pending — if it fails, change APP_NAME / PROTOCOL_TAG in this one file.
 */
export const APP_NAME = 'Freeport';
export const PROTOCOL_TAG = 'freeport';
export const SCHEMA_VERSION = 1;

/**
 * Nostr event kinds.
 *
 * Intents use addressable kinds (30000–39999, NIP-01): the latest event per
 * (pubkey, kind, d-tag) wins, so an intent can be updated or withdrawn by
 * republishing under the same d-tag. Expiry uses NIP-40 `expiration` tags.
 *
 * Negotiation messages travel inside encrypted DMs (NIP-04 for v1, NIP-17
 * planned) as JSON envelopes — the kinds below identify the envelope `type`
 * field, not standalone Nostr events.
 */
export const KIND_INTENT_OFFER = 32101;
export const KIND_INTENT_REQUEST = 32102;

export const MSG_COUNTER = 'negotiate.counter';
export const MSG_ACCEPT = 'negotiate.accept';
export const MSG_CANCEL = 'negotiate.cancel';

export type NegotiationMsgType =
  | typeof MSG_COUNTER
  | typeof MSG_ACCEPT
  | typeof MSG_CANCEL;

/** Default public relays for the prototype. Self-hosted relays get appended from config. */
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.nostr.band',
];

/** Demo verticals. */
export const DEMO_MARKET = 'sg-rideshare';
export const DEMO_SCHEMA = 'rideshare/1';

export const SERVICE_MARKET = 'sg-service';
export const SERVICE_SCHEMA = 'service/1';
