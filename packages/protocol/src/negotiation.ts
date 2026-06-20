import { MSG_ACCEPT, MSG_CANCEL, MSG_CANCEL_AGREE, MSG_CANCEL_DECLINE, MSG_CANCEL_REQUEST, MSG_CHAT, MSG_COUNTER, MSG_STATUS, SCHEMA_VERSION } from './constants.js';
import { negotiationId } from './intent.js';
import type {
  ChatMessage,
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
 * Merge an incoming counter's terms onto whatever is already on the table.
 *
 * A counter is a *partial* edit: the UI only fills the fields the user wants to
 * change and leaves the rest blank ("leave blank to keep"), so the outgoing
 * `terms` object omits unchanged fields entirely. If we replaced `nego.terms`
 * wholesale, a counter that only shifts the time would wipe a price that was
 * already haggled in an earlier round — and on confirm the deal card would fall
 * back to the original posted terms. Layering the new fields over the previous
 * terms preserves every field that wasn't explicitly re-proposed.
 */
function mergeTerms(prev: ProposedTerms | undefined, next: ProposedTerms): ProposedTerms {
  if (!prev) return next;
  const merged: ProposedTerms = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
  }
  return merged;
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

export function makeCounter(nego: Negotiation, terms: ProposedTerms, contact?: string): NegotiationMessage {
  if (nego.state !== 'open' && nego.state !== 'accepted_by_them') {
    throw new Error(`cannot counter in state ${nego.state}`);
  }
  if (nego.rounds >= MAX_ROUNDS) {
    throw new Error('max negotiation rounds reached — accept or cancel');
  }
  // Carry our full contact on the offer/counter too (not just on accept). It
  // rides the same encrypted NIP-04 DM, so it stays private to the peer — but it
  // lets them phone us mid-negotiation, since in-app delivery isn't guaranteed.
  return {
    v: SCHEMA_VERSION,
    type: MSG_COUNTER,
    nego: nego.id,
    intent_id: nego.intent.id,
    intent_d: nego.intent.d,
    market: nego.intent.content.market,
    terms,
    ...(contact ? { contact } : {}),
    ts: now(),
  };
}

export function makeAccept(nego: Negotiation, contact: string): NegotiationMessage {
  // A single Accept now confirms the deal. Sending an accept while already
  // `confirmed` is allowed too — that's the automatic contact back-flow: when
  // the peer accepts our proposal we auto-reply with our own contact so both
  // sides end up with each other's, without a second human "Confirm" tap.
  if (nego.state === 'cancelled' || nego.state === 'expired') {
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

export function makeChat(nego: Negotiation, text: string): NegotiationMessage {
  return {
    v: SCHEMA_VERSION,
    type: MSG_CHAT,
    nego: nego.id,
    intent_id: nego.intent.id,
    intent_d: nego.intent.d,
    market: nego.intent.content.market,
    text,
    ts: now(),
  };
}

/**
 * Fulfillment progress update on a confirmed deal (e.g. driver tapped
 * "Picked up" / "Completed trip"). Sent over the encrypted DM channel so the
 * counterparty's deal card reflects the same stage.
 */
export function makeStatus(nego: Negotiation, stage: 'picked_up' | 'completed'): NegotiationMessage {
  return {
    v: SCHEMA_VERSION,
    type: MSG_STATUS,
    nego: nego.id,
    intent_id: nego.intent.id,
    intent_d: nego.intent.d,
    market: nego.intent.content.market,
    stage,
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

/** Mutual-cancel envelope (request / agree / decline) for a confirmed deal. */
function makeCancelMsg(nego: Negotiation, type: typeof MSG_CANCEL_REQUEST | typeof MSG_CANCEL_AGREE | typeof MSG_CANCEL_DECLINE): NegotiationMessage {
  return {
    v: SCHEMA_VERSION,
    type,
    nego: nego.id,
    intent_id: nego.intent.id,
    intent_d: nego.intent.d,
    market: nego.intent.content.market,
    ts: now(),
  };
}
export const makeCancelRequest = (nego: Negotiation) => makeCancelMsg(nego, MSG_CANCEL_REQUEST);
export const makeCancelAgree = (nego: Negotiation) => makeCancelMsg(nego, MSG_CANCEL_AGREE);
export const makeCancelDecline = (nego: Negotiation) => makeCancelMsg(nego, MSG_CANCEL_DECLINE);

/** Apply an outbound message we are sending. */
export function applyOutbound(nego: Negotiation, msg: NegotiationMessage): Negotiation {
  const next: Negotiation = { ...nego, updatedAt: now(), log: [...nego.log, { dir: 'out' as const, msg }] };
  switch (msg.type) {
    case MSG_CHAT:
      next.messages = [...(nego.messages ?? []), { dir: 'out', text: msg.text ?? '', ts: msg.ts }];
      return next;
    case MSG_STATUS:
      next.stage = msg.stage;
      return next;
    case MSG_COUNTER:
      next.terms = mergeTerms(nego.terms, msg.terms!);
      next.termsBy = 'us';
      next.rounds = nego.rounds + 1;
      next.state = 'open';
      if (msg.contact) next.ourContact = msg.contact;
      return next;
    case MSG_ACCEPT:
      next.ourContact = msg.contact;
      // A single Accept confirms (one-step). If somehow already terminal, keep it.
      next.state = nego.state === 'cancelled' || nego.state === 'expired' ? nego.state : 'confirmed';
      return next;
    case MSG_CANCEL:
      next.state = 'cancelled';
      return next;
    case MSG_CANCEL_REQUEST:
      next.state = 'cancel_requested';
      next.cancelRequestedBy = 'us';
      return next;
    case MSG_CANCEL_AGREE:
      next.state = 'cancelled';
      next.cancelRequestedBy = undefined;
      return next;
    case MSG_CANCEL_DECLINE:
      next.state = 'confirmed';
      next.cancelRequestedBy = undefined;
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
  eventId?: string,
): Negotiation | null {
  if (msg.nego !== nego.id) return null;
  if (nego.peer && peerPubkey !== nego.peer) return null; // someone else injecting into the thread
  // Chat is allowed in any non-aborted state, including after `confirmed`
  // (that's where the two parties coordinate the meet-up).
  if (msg.type === MSG_CHAT) {
    if (nego.state === 'cancelled' || nego.state === 'expired') return null;
    if (!msg.text) return null;
    const msgs = nego.messages ?? [];
    // Idempotent against replays: relays redeliver the same kind:4 DM from each
    // connected relay, and the 7-day backfill replays it on every reload. Without
    // this guard each delivery appended another copy (and persisted it), so chat
    // messages multiplied on every app launch.
    if (eventId && msgs.some((m) => m.id === eventId)) return null;
    return {
      ...nego,
      peer: nego.peer || peerPubkey,
      updatedAt: now(),
      log: [...nego.log, { dir: 'in' as const, msg }],
      messages: [...msgs, { dir: 'in', text: msg.text, ts: msg.ts, id: eventId }],
    };
  }
  // Fulfillment progress on a confirmed deal — provider advances it, we mirror
  // it. Allowed while confirmed (or mid cancel-request); ignore otherwise.
  if (msg.type === MSG_STATUS) {
    if (nego.state !== 'confirmed' && nego.state !== 'cancel_requested') return null;
    if (msg.stage !== 'picked_up' && msg.stage !== 'completed') return null;
    // Stage only ever ADVANCES (undefined → picked_up → completed). Relays don't
    // guarantee chronological delivery, so on reload the backfilled status DMs
    // can replay out of order; without this guard a stale `picked_up` applied
    // after `completed` would revert a finished deal back to in-transit.
    const rank = (s?: string) => (s === 'completed' ? 2 : s === 'picked_up' ? 1 : 0);
    if (rank(msg.stage) <= rank(nego.stage)) return null;
    return {
      ...nego,
      peer: nego.peer || peerPubkey,
      updatedAt: now(),
      log: [...nego.log, { dir: 'in' as const, msg }],
      stage: msg.stage,
    };
  }
  // A single inbound Accept confirms the deal (one-step) and captures their
  // contact. Also handled while already `confirmed` so the automatic back-flow
  // accept (the peer's contact reply) still records their contact — it just
  // doesn't change state. Idempotent: a duplicate with the same contact is a no-op.
  if (msg.type === MSG_ACCEPT) {
    if (nego.state === 'cancelled' || nego.state === 'expired') return null;
    if (!msg.contact) return null;
    if (nego.state === 'confirmed' && nego.theirContact === msg.contact) return null;
    return {
      ...nego,
      peer: nego.peer || peerPubkey,
      updatedAt: now(),
      log: [...nego.log, { dir: 'in' as const, msg }],
      theirContact: msg.contact,
      // The accept echoes the full agreed terms; layer them over our local view
      // so a confirm never drops a field we'd already negotiated.
      terms: msg.terms ? mergeTerms(nego.terms, msg.terms) : nego.terms,
      state: 'confirmed',
    };
  }
  // Mutual cancellation of a confirmed deal (cooperative; no karma involved).
  if (msg.type === MSG_CANCEL_REQUEST || msg.type === MSG_CANCEL_AGREE || msg.type === MSG_CANCEL_DECLINE) {
    const base = { ...nego, peer: nego.peer || peerPubkey, updatedAt: now(), log: [...nego.log, { dir: 'in' as const, msg }] };
    if (msg.type === MSG_CANCEL_REQUEST) {
      if (nego.state !== 'confirmed') return null;
      // Can't cancel a trip that's already done.
      if (nego.stage === 'completed') return null;
      // Relays redeliver DMs out of order on reopen. A cancel-request we've
      // already seen (it's in the log) must not re-apply — otherwise an old
      // request the user already DECLINED resurrects the cancel prompt on a deal
      // that long since continued. Dedupe by (type, ts) rather than timestamp
      // ordering, since ts is only second-granular.
      if (nego.log.some((e) => e.msg?.type === MSG_CANCEL_REQUEST && e.msg?.ts === msg.ts)) return null;
      return { ...base, state: 'cancel_requested', cancelRequestedBy: 'them' };
    }
    if (nego.state !== 'cancel_requested') return null;
    if (msg.type === MSG_CANCEL_AGREE) return { ...base, state: 'cancelled', cancelRequestedBy: undefined };
    return { ...base, state: 'confirmed', cancelRequestedBy: undefined }; // decline → revert
  }
  // A hard, unilateral cancel from the peer — the intent owner sweeping a losing
  // bid ("filled — taken by another offer") or withdrawing the listing. It's
  // authoritative, so it must terminate even a locally-`confirmed` deal: the
  // accepting side one-tap-accepts and optimistically self-confirms BEFORE the
  // owner acks, so when the owner instead rejects it, a `confirmed`-state guard
  // would otherwise strand the loser on a phantom deal. Exceptions: a finished
  // trip (stage `completed`) is never undone, terminal negos are left as-is, and
  // a replayed cancel (same type+ts already in the log) is a no-op.
  if (msg.type === MSG_CANCEL) {
    if (nego.state === 'cancelled' || nego.state === 'expired') return null;
    if (nego.stage === 'completed') return null;
    if (nego.log.some((e) => e.msg?.type === MSG_CANCEL && e.msg?.ts === msg.ts)) return null;
    return {
      ...nego,
      peer: nego.peer || peerPubkey,
      updatedAt: now(),
      log: [...nego.log, { dir: 'in' as const, msg }],
      state: 'cancelled',
      cancelRequestedBy: undefined,
    };
  }
  if (nego.state === 'cancelled' || nego.state === 'expired' || nego.state === 'confirmed' || nego.state === 'cancel_requested') return null;

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
      next.terms = mergeTerms(nego.terms, msg.terms);
      next.termsBy = 'them';
      next.rounds = nego.rounds + 1;
      next.state = 'open';
      if (msg.contact) next.theirContact = msg.contact;
      return next;
    // MSG_CANCEL is handled above (it must reach `confirmed` negos too).
    default:
      return null;
  }
}

/**
 * Collapse duplicate chat messages. New messages carry a stable `id` (the source
 * DM event id) and are deduped by it. Messages persisted before `id` existed are
 * deduped by an exact (dir, text, ts) match — a true replay shares all three
 * (same event), whereas two genuinely-distinct messages differ in `ts`. Used to
 * heal stores that accumulated duplicates before the idempotent-chat fix landed.
 */
export function dedupeMessages(messages?: ChatMessage[]): ChatMessage[] {
  if (!messages?.length) return messages ?? [];
  const seen = new Set<string>();
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const key = m.id ? `id:${m.id}` : `k:${m.dir}|${m.ts}|${m.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out.length === messages.length ? messages : out;
}

/** Return a copy of the negotiation with its chat de-duplicated. */
export function dedupeNegotiationMessages(nego: Negotiation): Negotiation {
  const messages = dedupeMessages(nego.messages);
  return messages === nego.messages ? nego : { ...nego, messages };
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
  const VALID = [MSG_COUNTER, MSG_ACCEPT, MSG_CANCEL, MSG_CHAT, MSG_CANCEL_REQUEST, MSG_CANCEL_AGREE, MSG_CANCEL_DECLINE, MSG_STATUS];
  if (!VALID.includes(msg.type as any)) return null;
  if (typeof msg.nego !== 'string' || typeof msg.intent_id !== 'string') return null;
  return msg;
}
