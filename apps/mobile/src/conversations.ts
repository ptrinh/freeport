/**
 * Friend-chat conversation model — the client-side state a chat.* envelope
 * stream folds into. One conversation per peer pubkey (there is no thread id;
 * the peer IS the thread). Pure functions so the whole state machine is
 * unit-testable without a client or relay.
 *
 * States:
 *   pending_out — we sent chat.invite, waiting for their accept
 *   pending_in  — they sent chat.invite, waiting for OUR accept/reject
 *   active      — both sides in; messages flow
 *   rejected    — they rejected our invite (kept as a tombstone so a relay
 *                 replay of the old invite doesn't resurrect the request)
 */
import { CHAT_ACCEPT, CHAT_ACK, CHAT_INVITE, CHAT_MSG, CHAT_REACT, CHAT_REJECT, CHAT_TTL, type ChatEnvelope, type ChatMessage } from '@freeport/protocol';

export type ConversationState = 'pending_out' | 'pending_in' | 'active' | 'rejected';

export interface Conversation {
  /** Counterparty pubkey (hex) — the conversation key. */
  peer: string;
  state: ConversationState;
  /** Display name carried on their invite/accept (kind:0 profile can override). */
  name?: string;
  /** Local-only: hidden from the main list. Cleared when a new message arrives. */
  archived?: boolean;
  messages: ChatMessage[];
  updatedAt: number;
  /** Newest inbound ts the user has SEEN (conversation opened) — drives unread. */
  myReadTs?: number;
  /** Their receipts for OUR messages (shown as ticks when receipts are on). */
  theirDeliveredTs?: number;
  theirReadTs?: number;
  /** Their last-seen, from acks — only present when they share it. */
  theirLastSeen?: number;
  /** Their lightning address (from invite/accept) — enables in-chat payments. */
  theirPay?: string;
  /** Disappearing-messages timer (seconds), synced both ways. undefined/0 = off. */
  disappearTtl?: number;
  /** Replay guard, same as Negotiation.seenEventIds (bounded). */
  seenEventIds?: string[];
}

const SEEN_MAX = 500;
const MESSAGES_MAX = 1000;
const nowSec = () => Math.floor(Date.now() / 1000);

export function newConversation(peer: string, state: ConversationState, name?: string): Conversation {
  return { peer, state, ...(name ? { name } : {}), messages: [], updatedAt: nowSec() };
}

/** Fold our own outbound envelope into the conversation. `eventId` is the
 *  sent DM's id — stored on outbound messages so BOTH sides share one
 *  identifier per message (reply/reaction targets). */
export function applyChatOutbound(conv: Conversation, env: ChatEnvelope, eventId?: string): Conversation {
  const next: Conversation = { ...conv, updatedAt: nowSec() };
  switch (env.type) {
    case CHAT_INVITE:
      next.state = conv.state === 'active' ? 'active' : 'pending_out';
      return next;
    case CHAT_ACCEPT:
      next.state = 'active';
      return next;
    case CHAT_MSG:
      next.messages = [...conv.messages, {
        dir: 'out' as const, text: env.text ?? '', ts: env.ts, id: eventId,
        ...(env.reply_to ? { replyTo: env.reply_to, quote: env.quote } : {}),
        ...(env.expires_in ? { expiresAt: env.ts + env.expires_in } : {}),
      }].slice(-MESSAGES_MAX);
      // Sending into an archived chat un-archives it.
      next.archived = false;
      return next;
    case CHAT_REACT:
      next.messages = applyReaction(conv.messages, env.target!, env.emoji ?? '', 'out');
      return next;
    case CHAT_TTL:
      next.disappearTtl = env.seconds || undefined;
      return next;
    default:
      return conv; // reject handled by dropping; acks don't change our view
  }
}

/** One reaction per side per message; '' removes that side's reaction.
 *  Returns the SAME array when the target isn't found (caller drops the event). */
function applyReaction(messages: ChatMessage[], target: string, emoji: string, dir: 'in' | 'out'): ChatMessage[] {
  if (!messages.some((m) => m.id === target)) return messages;
  return messages.map((m) => {
    if (m.id !== target) return m;
    const others = (m.reactions ?? []).filter((r) => r.dir !== dir);
    return { ...m, reactions: emoji ? [...others, { emoji, dir }] : others };
  });
}

/** Drop messages past their disappearing deadline. Same ref when unchanged. */
export function sweepExpired(conv: Conversation, now = nowSec()): Conversation {
  if (!conv.messages.some((m) => m.expiresAt && m.expiresAt <= now)) return conv;
  return { ...conv, messages: conv.messages.filter((m) => !m.expiresAt || m.expiresAt > now) };
}

/**
 * Fold an inbound envelope from `peer` into the (possibly absent) conversation.
 * Returns the updated conversation, or null when the envelope should be
 * ignored (replay, invalid for the current state, message from a stranger).
 */
export function applyChatInbound(
  conv: Conversation | undefined,
  env: ChatEnvelope,
  peer: string,
  eventId?: string,
): Conversation | null {
  if (conv && eventId && conv.seenEventIds?.includes(eventId)) return null;
  const next = applyChatInboundUnchecked(conv, env, peer, eventId);
  if (!next || !eventId) return next;
  const seen = conv?.seenEventIds ?? [];
  return { ...next, seenEventIds: [...seen.slice(1 - SEEN_MAX), eventId] };
}

function applyChatInboundUnchecked(
  conv: Conversation | undefined,
  env: ChatEnvelope,
  peer: string,
  eventId?: string,
): Conversation | null {
  const ts = nowSec();
  if (env.type === CHAT_INVITE) {
    // A fresh request — or, if we'd already invited THEM, mutual interest:
    // both sides tapped each other's invite, no accept round needed.
    if (!conv) return { ...newConversation(peer, 'pending_in', env.name), theirPay: env.pay, updatedAt: ts };
    if (conv.state === 'pending_out') return { ...conv, state: 'active', name: conv.name ?? env.name, theirPay: env.pay ?? conv.theirPay, updatedAt: ts };
    if (conv.state === 'rejected') return { ...conv, state: 'pending_in', name: env.name ?? conv.name, theirPay: env.pay ?? conv.theirPay, updatedAt: ts };
    return null; // active or already pending_in — replayed invite, no-op
  }
  if (env.type === CHAT_ACCEPT) {
    if (!conv || conv.state !== 'pending_out') return null;
    return { ...conv, state: 'active', name: conv.name ?? env.name, theirPay: env.pay ?? conv.theirPay, updatedAt: ts };
  }
  if (env.type === CHAT_REJECT) {
    if (!conv || conv.state !== 'pending_out') return null;
    return { ...conv, state: 'rejected', updatedAt: ts };
  }
  if (env.type === CHAT_MSG) {
    if (!conv) return null; // stranger with no handshake — the spam gate
    if (conv.state === 'rejected' || conv.state === 'pending_in') return null;
    // A message while we're pending_out implies our invite WAS accepted and
    // the accept got lost — heal instead of dropping their first message.
    const msgs = conv.messages;
    if (eventId && msgs.some((m) => m.id === eventId)) return null;
    return {
      ...conv,
      state: 'active',
      updatedAt: ts,
      archived: false, // new activity resurfaces an archived chat
      messages: [...msgs, {
        dir: 'in' as const, text: env.text ?? '', ts: env.ts, id: eventId,
        ...(env.reply_to ? { replyTo: env.reply_to, quote: env.quote } : {}),
        // The SENDER's expires_in is authoritative — never our own timer.
        ...(env.expires_in ? { expiresAt: env.ts + env.expires_in } : {}),
      }].slice(-MESSAGES_MAX),
    };
  }
  if (env.type === CHAT_REACT) {
    if (!conv || conv.state !== 'active') return null;
    const messages = applyReaction(conv.messages, env.target!, env.emoji ?? '', 'in');
    if (messages === conv.messages) return null; // unknown target (expired?) — drop
    return { ...conv, messages };
  }
  if (env.type === CHAT_TTL) {
    if (!conv || conv.state !== 'active') return null;
    return { ...conv, disappearTtl: env.seconds || undefined, updatedAt: ts };
  }
  if (env.type === CHAT_ACK) {
    if (!conv || conv.state !== 'active') return null;
    const upTo = env.up_to ?? 0;
    const next: Conversation = { ...conv };
    if (env.ack === 'read') {
      if (upTo > (conv.theirReadTs ?? 0)) next.theirReadTs = upTo;
      // read implies delivered
      if (upTo > (conv.theirDeliveredTs ?? 0)) next.theirDeliveredTs = upTo;
    } else if (upTo > (conv.theirDeliveredTs ?? 0)) {
      next.theirDeliveredTs = upTo;
    }
    if (env.last_seen && env.last_seen > (conv.theirLastSeen ?? 0)) next.theirLastSeen = env.last_seen;
    // Acks are metadata — don't bump updatedAt (it would reorder the list).
    return next;
  }
  return null;
}

/** Unread inbound messages (newer than the user's last read mark). */
export function unreadCount(conv: Conversation): number {
  if (conv.state !== 'active' && conv.state !== 'pending_in') return 0;
  const read = conv.myReadTs ?? 0;
  return conv.messages.filter((m) => m.dir === 'in' && m.ts > read).length;
}

/** Tick state for an outbound message, WhatsApp-style. */
export function tickFor(conv: Conversation, msgTs: number): 'sent' | 'delivered' | 'read' {
  if ((conv.theirReadTs ?? 0) >= msgTs) return 'read';
  if ((conv.theirDeliveredTs ?? 0) >= msgTs) return 'delivered';
  return 'sent';
}
