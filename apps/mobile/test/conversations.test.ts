/** Friend-chat conversation state machine (pure reducer — no client/relay). */
import { describe, it, expect } from 'vitest';
import { makeChatAccept, makeChatAck, makeChatInvite, makeChatMsg, makeChatReject } from '@freeport/protocol';
import { applyChatInbound, applyChatOutbound, newConversation, tickFor, unreadCount, type Conversation } from '../src/conversations';

const PEER = 'f'.repeat(64);

describe('handshake', () => {
  it('inbound invite from a stranger → pending_in', () => {
    const conv = applyChatInbound(undefined, makeChatInvite('Alice'), PEER, 'ev1');
    expect(conv?.state).toBe('pending_in');
    expect(conv?.name).toBe('Alice');
  });

  it('our invite → pending_out; their accept → active', () => {
    let conv = applyChatOutbound(newConversation(PEER, 'pending_out'), makeChatInvite());
    expect(conv.state).toBe('pending_out');
    const next = applyChatInbound(conv, makeChatAccept('Bob'), PEER, 'ev2');
    expect(next?.state).toBe('active');
    expect(next?.name).toBe('Bob');
  });

  it('crossed invites (both invited each other) go straight to active', () => {
    const conv = applyChatOutbound(newConversation(PEER, 'pending_out'), makeChatInvite());
    const next = applyChatInbound(conv, makeChatInvite('Bob'), PEER, 'ev3');
    expect(next?.state).toBe('active');
  });

  it('reject tombstones pending_out; a fresh invite can revive it', () => {
    const conv = applyChatOutbound(newConversation(PEER, 'pending_out'), makeChatInvite());
    const rejected = applyChatInbound(conv, makeChatReject(), PEER, 'ev4')!;
    expect(rejected.state).toBe('rejected');
    // Their change of heart: they invite US later.
    const revived = applyChatInbound(rejected, makeChatInvite('Bob'), PEER, 'ev5');
    expect(revived?.state).toBe('pending_in');
  });

  it('a message from a total stranger (no handshake) is dropped — spam gate', () => {
    expect(applyChatInbound(undefined, makeChatMsg('yo'), PEER, 'ev6')).toBeNull();
  });

  it('a message while pending_in stays gated (they must wait for our accept)', () => {
    const conv = applyChatInbound(undefined, makeChatInvite(), PEER, 'ev7')!;
    expect(applyChatInbound(conv, makeChatMsg('early'), PEER, 'ev8')).toBeNull();
  });

  it('a message while pending_out heals a lost accept', () => {
    const conv = applyChatOutbound(newConversation(PEER, 'pending_out'), makeChatInvite());
    const next = applyChatInbound(conv, makeChatMsg('hey! accepted'), PEER, 'ev9');
    expect(next?.state).toBe('active');
    expect(next?.messages).toHaveLength(1);
  });
});

describe('messages & replays', () => {
  const active = (): Conversation => ({ ...newConversation(PEER, 'active'), messages: [] });

  it('inbound/outbound messages append; replays (same event id) are no-ops', () => {
    let conv = applyChatInbound(active(), makeChatMsg('one'), PEER, 'dup')!;
    expect(conv.messages).toHaveLength(1);
    expect(applyChatInbound(conv, makeChatMsg('one'), PEER, 'dup')).toBeNull();
    conv = applyChatOutbound(conv, makeChatMsg('two'));
    expect(conv.messages.map((m) => m.dir)).toEqual(['in', 'out']);
  });

  it('new inbound activity un-archives the chat', () => {
    const conv = { ...active(), archived: true };
    const next = applyChatInbound(conv, makeChatMsg('ping'), PEER, 'ev10');
    expect(next?.archived).toBe(false);
  });

  it('unreadCount tracks the read mark', () => {
    let conv = applyChatInbound(active(), makeChatMsg('a'), PEER, 'e1')!;
    conv = applyChatInbound(conv, makeChatMsg('b'), PEER, 'e2')!;
    expect(unreadCount(conv)).toBe(2);
    expect(unreadCount({ ...conv, myReadTs: Math.floor(Date.now() / 1000) + 1 })).toBe(0);
  });
});

describe('receipts (acks)', () => {
  it('delivered/read advance monotonically; read implies delivered', () => {
    let conv: Conversation = { ...newConversation(PEER, 'active') };
    conv = applyChatInbound(conv, makeChatAck('delivered', 100), PEER, 'a1')!;
    expect(conv.theirDeliveredTs).toBe(100);
    conv = applyChatInbound(conv, makeChatAck('read', 90), PEER, 'a2')!;
    expect(conv.theirReadTs).toBe(90);
    expect(conv.theirDeliveredTs).toBe(100); // never regresses
    expect(tickFor(conv, 80)).toBe('read');
    expect(tickFor(conv, 95)).toBe('delivered');
    expect(tickFor(conv, 200)).toBe('sent');
  });

  it('last_seen rides the ack and only moves forward', () => {
    let conv: Conversation = { ...newConversation(PEER, 'active') };
    conv = applyChatInbound(conv, makeChatAck('delivered', 1, 500), PEER, 'a3')!;
    expect(conv.theirLastSeen).toBe(500);
    const stale = applyChatInbound(conv, makeChatAck('delivered', 2, 400), PEER, 'a4')!;
    expect(stale.theirLastSeen).toBe(500);
  });

  it('acks are ignored outside an active conversation', () => {
    const pending = applyChatInbound(undefined, makeChatInvite(), PEER, 'a5')!;
    expect(applyChatInbound(pending, makeChatAck('read', 10), PEER, 'a6')).toBeNull();
  });
});
