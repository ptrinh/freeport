import { MSG_ACCEPT, MSG_CANCEL, MSG_COUNTER, SCHEMA_VERSION } from './constants.js';
import { negotiationId } from './intent.js';
import type {
  Intent,
  Negotiation,
  NegotiationMessage,
  ProposedTerms,
} from './types.js';

const MAX_ROUNDS = 8; // runaway-agent guard: after this, only accept/cancel

function now(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Start a negotiation. If we initiate (responding to someone else's public
 * intent), we are the responder. If they initiated against OUR intent,
 * pass their pubkey so both sides derive the same negotiation id.
 */
export function openNegotiation(
  intent: Intent,
  ourPubkey: string,
  weInitiated: boolean,
  peerPubkey?: string,
): Negotiation {
  const responder = weInitiated ? ourPubkey : (peerPubkey ?? '');
  return {
    id: negotiationId(intent.d, intent.pubkey, responder),
    intent,
    peer: weInitiated ? intent.pubkey : (peerPubkey ?? ''),
    weInitiated,
    state: 'open',
    rounds: 0,
    updatedAt: now(),
    log: [],
  };
}

export function makeCounter(nego: Negotiation, terms: ProposedTerms): NegotiationMessage {
  if (nego.state !== 'open' && nego.state !== 'accepted_by_them') {
    throw new Error(`cannot counter in state ${nego.state}`);
  }
  if (nego.rounds >= MAX_ROUNDS) {
    throw new Error('max negotiation rounds reached — accept or cancel');
  }
  return {
    v: SCHEMA_VERSION,
    type: MSG_COUNTER,
    nego: nego.id,
    intent_id: nego.intent.id,
    intent_d: nego.intent.d,
    market: nego.intent.content.market,
    terms,
    ts: now(),
  };
}

export function makeAccept(nego: Negotiation, contact: string): NegotiationMessage {
  if (nego.state !== 'open' && nego.state !== 'accepted_by_them') {
    throw new Error(`cannot accept in state ${nego.state}`);
  }
  if (!nego.terms) throw new Error('no terms on the table to accept');
  return {
    v: SCHEMA_VERSION,
    type: MSG_ACCEPT,
    nego: nego.id,
    intent_id: nego.intent.id,
    intent_d: nego.intent.d,
    market: nego.intent.content.market,
    terms: nego.terms,
    contact,
    ts: now(),
  };
}

export function makeCancel(nego: Negotiation, reason?: string): NegotiationMessage {
  return {
    v: SCHEMA_VERSION,
    type: MSG_CANCEL,
    nego: nego.id,
    intent_id: nego.intent.id,
    intent_d: nego.intent.d,
    market: nego.intent.content.market,
    reason,
    ts: now(),
  };
}

/** Apply an outbound message we are sending. */
export function applyOutbound(nego: Negotiation, msg: NegotiationMessage): Negotiation {
  const next: Negotiation = { ...nego, updatedAt: now(), log: [...nego.log, { dir: 'out' as const, msg }] };
  switch (msg.type) {
    case MSG_COUNTER:
      next.terms = msg.terms;
      next.termsBy = 'us';
      next.rounds = nego.rounds + 1;
      next.state = 'open';
      return next;
    case MSG_ACCEPT:
      next.ourContact = msg.contact;
      // If they already accepted, our accept seals the deal.
      next.state = nego.state === 'accepted_by_them' ? 'confirmed' : 'accepted_by_us';
      return next;
    case MSG_CANCEL:
      next.state = 'cancelled';
      return next;
  }
}

/**
 * Apply an inbound message from the peer. Returns the updated negotiation,
 * or null if the message is invalid for the current state (ignore it).
 */
export function applyInbound(
  nego: Negotiation,
  msg: NegotiationMessage,
  peerPubkey: string,
): Negotiation | null {
  if (msg.nego !== nego.id) return null;
  if (nego.peer && peerPubkey !== nego.peer) return null; // someone else injecting into the thread
  if (nego.state === 'cancelled' || nego.state === 'expired' || nego.state === 'confirmed') return null;

  const next: Negotiation = {
    ...nego,
    peer: nego.peer || peerPubkey,
    updatedAt: now(),
    log: [...nego.log, { dir: 'in' as const, msg }],
  };
  switch (msg.type) {
    case MSG_COUNTER:
      if (!msg.terms) return null;
      if (nego.rounds >= MAX_ROUNDS) return null;
      next.terms = msg.terms;
      next.termsBy = 'them';
      next.rounds = nego.rounds + 1;
      next.state = 'open';
      return next;
    case MSG_ACCEPT:
      // Accepting stale terms (not what's on the table) is invalid — unless
      // they accept their own last counter's terms verbatim, which is a no-op
      // re-accept and fine.
      next.theirContact = msg.contact;
      next.terms = msg.terms ?? nego.terms;
      // If we already accepted, their accept seals the deal.
      next.state = nego.state === 'accepted_by_us' ? 'confirmed' : 'accepted_by_them';
      return next;
    case MSG_CANCEL:
      next.state = 'cancelled';
      return next;
    default:
      return null;
  }
}

export function expireNegotiation(nego: Negotiation): Negotiation {
  if (nego.state === 'confirmed' || nego.state === 'cancelled') return nego;
  return { ...nego, state: 'expired', updatedAt: now() };
}

export function isTerminal(nego: Negotiation): boolean {
  return nego.state === 'confirmed' || nego.state === 'cancelled' || nego.state === 'expired';
}

export function parseNegotiationMessage(json: string): NegotiationMessage | null {
  let msg: NegotiationMessage;
  try {
    msg = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof msg !== 'object' || msg === null) return null;
  if (msg.v !== SCHEMA_VERSION) return null;
  if (msg.type !== MSG_COUNTER && msg.type !== MSG_ACCEPT && msg.type !== MSG_CANCEL) return null;
  if (typeof msg.nego !== 'string' || typeof msg.intent_id !== 'string') return null;
  return msg;
}
