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
  price_hint?: string; // free text in v1 ("$10", "split petrol")
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
  reason?: string; // for cancel
  ts: EpochSeconds;
}

export interface ProposedTerms {
  window?: TimeWindow;
  price?: string;
  note?: string;
  [k: string]: unknown;
}

export type NegotiationState =
  | 'open' // counters in flight
  | 'accepted_by_us' // we sent accept (with contact), waiting for theirs
  | 'accepted_by_them' // they accepted; needs our (human-confirmed) accept
  | 'confirmed' // both accepts exchanged — deal done
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
  /** Last terms on the table and who proposed them. */
  terms?: ProposedTerms;
  termsBy?: 'us' | 'them';
  rounds: number;
  ourContact?: string;
  theirContact?: string;
  updatedAt: EpochSeconds;
  log: { dir: 'in' | 'out'; msg: NegotiationMessage }[];
}
