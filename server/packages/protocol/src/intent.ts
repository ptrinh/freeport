import { finalizeEvent, type Event, type EventTemplate } from 'nostr-tools/pure';
import {
  KIND_INTENT_OFFER,
  KIND_INTENT_REQUEST,
  PROTOCOL_TAG,
  SCHEMA_VERSION,
} from './constants.js';
import type { Intent, IntentContent, IntentSide } from './types.js';

export function kindForSide(side: IntentSide): number {
  return side === 'offer' ? KIND_INTENT_OFFER : KIND_INTENT_REQUEST;
}

export interface BuildIntentInput {
  side: IntentSide;
  market: string;
  schema: string;
  title: string;
  payload: Record<string, unknown>;
  window?: { start: number; end: number };
  flexMinutes?: number;
  expiresAt: number;
  /** Stable id across republishes. Defaults to a random one. */
  d?: string;
  /** Geohashes to tag for location-scoped discovery. */
  geohashes?: string[];
  /** Extra topic (`t`) tags for sharded discovery (location/category/subcategory). */
  topics?: string[];
  createdAt?: number;
}

/** Build the unsigned intent event template (for external signers, e.g. NIP-07). */
export function buildIntentTemplate(input: BuildIntentInput): EventTemplate {
  const content: IntentContent = {
    v: SCHEMA_VERSION,
    side: input.side,
    market: input.market,
    schema: input.schema,
    title: input.title,
    payload: input.payload,
    window: input.window,
    flex_minutes: input.flexMinutes,
    expires_at: input.expiresAt,
  };
  const d = input.d ?? randomId();
  const tags: string[][] = [
    ['d', d],
    ['t', input.market],
    ['expiration', String(input.expiresAt)],
    [PROTOCOL_TAG, String(SCHEMA_VERSION)],
  ];
  for (const g of input.geohashes ?? []) tags.push(['g', g]);
  // Sharded topic tags (e.g. vn_hanoi, vn_hanoi_ridesharing, …) — deduped.
  for (const t of [...new Set(input.topics ?? [])]) tags.push(['t', t]);
  return {
    kind: kindForSide(input.side),
    created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify(content),
  };
}

export function buildIntentEvent(input: BuildIntentInput, secretKey: Uint8Array): Event {
  return finalizeEvent(buildIntentTemplate(input), secretKey);
}

/**
 * A withdrawal is just a republish under the same d-tag with an
 * already-passed expiration and empty payload — relays replace the old one.
 */
export function buildWithdrawEvent(intent: Intent, secretKey: Uint8Array): Event {
  const now = Math.floor(Date.now() / 1000);
  return buildIntentEvent(
    {
      side: intent.content.side,
      market: intent.content.market,
      schema: intent.content.schema,
      title: '(withdrawn)',
      payload: {},
      expiresAt: now,
      d: intent.d,
      createdAt: now,
    },
    secretKey,
  );
}

/** Parse + validate an intent event. Returns null for anything malformed. */
export function parseIntentEvent(ev: Event): Intent | null {
  if (ev.kind !== KIND_INTENT_OFFER && ev.kind !== KIND_INTENT_REQUEST) return null;
  const d = ev.tags.find((t) => t[0] === 'd')?.[1];
  if (!d) return null;
  let content: IntentContent;
  try {
    content = JSON.parse(ev.content);
  } catch {
    return null;
  }
  if (typeof content !== 'object' || content === null) return null;
  if (content.v !== SCHEMA_VERSION) return null; // future: version negotiation
  if (content.side !== 'offer' && content.side !== 'request') return null;
  if ((content.side === 'offer') !== (ev.kind === KIND_INTENT_OFFER)) return null;
  if (typeof content.market !== 'string' || !content.market) return null;
  if (typeof content.schema !== 'string') return null;
  if (typeof content.expires_at !== 'number') return null;
  if (typeof content.payload !== 'object' || content.payload === null) return null;
  return {
    id: ev.id,
    pubkey: ev.pubkey,
    d,
    createdAt: ev.created_at,
    content,
  };
}

export function intentExpired(intent: Intent, now = Math.floor(Date.now() / 1000)): boolean {
  return intent.content.expires_at <= now;
}

export function negotiationId(intentD: string, intentPubkey: string, responderPubkey: string): string {
  return `${intentD}:${intentPubkey}:${responderPubkey}`;
}

export function randomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
