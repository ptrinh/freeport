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
/**
 * Karma rating for a completed deal. Addressable by (pubkey, kind, d-tag),
 * where d = nego-id, so each rater can only rate a given deal once.
 * Score: -1 (bad) | 0 (neutral) | 1 (good) | 2 (excellent).
 */
export const KIND_KARMA = 32103;
/**
 * Deal receipt — each party publishes its own half when a negotiation reaches
 * `confirmed`. Addressable by (pubkey, kind, d-tag) with d = nego-id and
 * p-tag = counterparty. A deal counts as proven only when BOTH halves exist
 * (A signs p=B and B signs p=A for the same d), so neither side can fabricate
 * a deal alone. Karma events are only counted against a proven receipt pair.
 */
export const KIND_DEAL_RECEIPT = 32104;
/**
 * Friend-chat invite — addressable by (pubkey, kind, d-tag) where d is a short
 * invite code. The code is a HASH COMMITMENT to the inviter's pubkey
 * (base32(sha256(pubkey ‖ nonce))[:10]), NOT a random string: d-tags are only
 * unique per (kind, pubkey, d), so anyone could republish the same code under
 * their own key. Resolvers recompute the hash from each candidate's author +
 * nonce and discard events whose author doesn't match — a hijacked code is
 * unresolvable by construction. Revoked by republishing the same d empty
 * (the intent-withdraw mechanism). See docs/ROADMAP.md (friend chat).
 */
export const KIND_CHAT_INVITE = 32105;

/**
 * Friend-chat envelope types — JSON inside encrypted DMs, like the negotiation
 * envelopes but keyed purely on the peer pubkey (no intent). Parsed BEFORE the
 * negotiation path; clients that predate chat drop them silently.
 */
export const CHAT_INVITE = 'chat.invite';
export const CHAT_ACCEPT = 'chat.accept';
export const CHAT_REJECT = 'chat.reject';
export const CHAT_MSG = 'chat.msg';
/** Delivery/read receipt; also carries last-seen (only to accepted contacts). */
export const CHAT_ACK = 'chat.ack';
/** Emoji reaction on a message (encrypted, unlike public NIP-25). */
export const CHAT_REACT = 'chat.react';
/** Per-conversation disappearing-messages timer, synced to both sides. */
export const CHAT_TTL = 'chat.ttl';

export type ChatMsgType =
  | typeof CHAT_INVITE
  | typeof CHAT_ACCEPT
  | typeof CHAT_REJECT
  | typeof CHAT_MSG
  | typeof CHAT_ACK
  | typeof CHAT_REACT
  | typeof CHAT_TTL;

export const MSG_COUNTER = 'negotiate.counter';
export const MSG_ACCEPT = 'negotiate.accept';
export const MSG_CANCEL = 'negotiate.cancel';
export const MSG_CHAT = 'negotiate.chat';
/** Mutual cancellation of a confirmed deal (cooperative, no karma penalty). */
export const MSG_CANCEL_REQUEST = 'negotiate.cancel_request';
export const MSG_CANCEL_AGREE = 'negotiate.cancel_agree';
export const MSG_CANCEL_DECLINE = 'negotiate.cancel_decline';
/** Fulfillment progress on a confirmed deal (picked up → completed). */
export const MSG_STATUS = 'negotiate.status';

export type NegotiationMsgType =
  | typeof MSG_COUNTER
  | typeof MSG_ACCEPT
  | typeof MSG_CANCEL
  | typeof MSG_CHAT
  | typeof MSG_CANCEL_REQUEST
  | typeof MSG_CANCEL_AGREE
  | typeof MSG_CANCEL_DECLINE
  | typeof MSG_STATUS;

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
