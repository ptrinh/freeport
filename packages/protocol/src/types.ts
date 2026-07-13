import type { NegotiationMsgType } from './constants.js';

export type IntentSide = 'offer' | 'request';

/** ISO-ish epoch seconds, matching Nostr's created_at convention. */
export type EpochSeconds = number;

export interface TimeWindow {
  /** Epoch seconds, inclusive. */
  start: EpochSeconds;
  end: EpochSeconds;
}

/**
 * Content (JSON) of a Freeport intent event.
 *
 * `payload` is vertical-specific and validated against `schema`
 * (e.g. "rideshare/1"). Everything else is universal.
 */
export interface IntentContent {
  v: number; // protocol schema version
  side: IntentSide;
  market: string; // topic, mirrors the `t` tag
  schema: string; // vertical payload schema id, e.g. "rideshare/1"
  title: string; // short human-readable summary
  payload: Record<string, unknown>;
  window?: TimeWindow; // when the offered/requested thing happens
  flex_minutes?: number; // how far the window can shift in negotiation
  expires_at: EpochSeconds; // mirrors NIP-40 expiration tag
  /**
   * Reserved for a later Lightning phase. Absent in v1. Adding it is a
   * non-breaking change because agents must ignore unknown fields.
   */
  payment?: unknown;
}

/** Vertical payload for schema "rideshare/1". */
export interface RidesharePayload extends Record<string, unknown> {
  from: { name: string; geohash: string };
  to: { name: string; geohash: string };
  seats?: number;
  category?: string; // vehicle subcategory (Motorbike, Compact Car, …)
  payment?: string; // e.g. "$12", "split petrol"
  note?: string; // short free-text note (≤100 chars)
  images?: string[]; // NIP-96 URLs
}

/** Vertical payload for schema "service/1". */
export interface ServicePayload extends Record<string, unknown> {
  location: { name: string; geohash: string };
  service: string; // e.g. "plumber", "house cleaning"
  category?: string; // coarse category for discovery/filtering
  subcategory?: string; // finer subcategory within the category
  payment?: string; // e.g. "$80/hr"
  duration_minutes?: number; // estimated duration
  notes?: string; // additional information
  images?: string[]; // NIP-96 URLs — photos of the problem/location
}

/** A parsed intent: validated content + the event identifiers we need. */
export interface Intent {
  id: string; // event id
  pubkey: string;
  d: string; // d-tag (stable intent id across republishes)
  createdAt: EpochSeconds;
  content: IntentContent;
}

/**
 * Negotiation messages — JSON envelopes carried in encrypted DMs.
 * `nego` identifies the negotiation thread: `${intentEventId}` plus the
 * initiating responder's pubkey makes it unique per pair.
 */
export interface NegotiationMessage {
  v: number;
  type: NegotiationMsgType;
  nego: string; // negotiation id: `${intent.d}:${intent.pubkey}:${responderPubkey}`
  intent_id: string; // event id of the public intent being negotiated
  intent_d: string;
  market: string;
  /** Proposed terms. For counter: the new terms. For accept: the terms being accepted. */
  terms?: ProposedTerms;
  /** Only present on accept — never sent before a deal is sealed. */
  contact?: string;
  /** Wallet receive address (Spark address / lightning address), sent on
   *  accept when the sender has the in-app wallet enabled. Lets the payer
   *  side show a Pay button on the confirmed deal. */
  payAddress?: string;
  reason?: string; // for cancel
  text?: string; // free-text chat message (for chat type)
  /** Fulfillment progress on a confirmed deal (for status type). */
  stage?: 'picked_up' | 'completed';
  ts: EpochSeconds;
}

export interface ChatMessage {
  dir: 'in' | 'out';
  text: string;
  ts: EpochSeconds;
  /**
   * Source DM event id — inbound: the received event's id; outbound (friend
   * chat): the sent event's id, so BOTH sides share one identifier per
   * message (reply/reaction targets). Optional for back-compat.
   */
  id?: string;
  /** Friend chat: id of the message this replies to + a short quoted snapshot. */
  replyTo?: string;
  quote?: string;
  /** Friend chat: disappearing-messages deadline (epoch seconds). */
  expiresAt?: EpochSeconds;
  /** Friend chat: emoji reactions (one per side — the latest wins). */
  reactions?: { emoji: string; dir: 'in' | 'out' }[];
}

export interface ProposedTerms {
  window?: TimeWindow;
  payment?: string;
  note?: string;
  // rideshare
  from?: string;
  to?: string;
  // service
  location?: string;
  service?: string;
  duration_minutes?: number;
  [k: string]: unknown;
}

export type NegotiationState =
  | 'open' // counters in flight
  | 'accepted_by_us' // we sent accept (with contact), waiting for theirs
  | 'accepted_by_them' // they accepted; needs our (human-confirmed) accept
  | 'confirmed' // both accepts exchanged — deal done
  | 'cancel_requested' // a confirmed deal where one side asked to mutually cancel
  | 'cancelled'
  | 'expired';

export interface Negotiation {
  id: string;
  intent: Intent;
  /** The counterparty agent. */
  peer: string;
  /** True if we initiated (responded to their public intent). */
  weInitiated: boolean;
  state: NegotiationState;
  /** Counterparty's wallet receive address from their accept, if any. */
  theirPayAddress?: string;
  /** Last terms on the table and who proposed them. */
  terms?: ProposedTerms;
  termsBy?: 'us' | 'them';
  rounds: number;
  ourContact?: string;
  theirContact?: string;
  /** Who asked to cancel, while state is `cancel_requested`. */
  cancelRequestedBy?: 'us' | 'them';
  updatedAt: EpochSeconds;
  log: { dir: 'in' | 'out'; msg: NegotiationMessage }[];
  /** Free-text chat, mainly used after the deal is confirmed to coordinate. */
  messages?: ChatMessage[];
  /**
   * Fulfillment progress on a confirmed deal, mirrored to both parties: the
   * provider (driver) advances it and the message syncs it to the requester.
   * undefined → not started; 'picked_up' → in transit; 'completed' → done.
   */
  stage?: 'picked_up' | 'completed';
  /**
   * Source DM event ids already applied to this negotiation. Relays redeliver
   * the same kind:4 event (once per connected relay, and again on every
   * startup backfill); any inbound message whose event id is here is a replay
   * and must be a no-op. Bounded (most recent 500).
   */
  seenEventIds?: string[];
}
