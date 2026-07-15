/**
 * Chat management client methods (client.ts): clear-messages, delete-conversation,
 * and the sticky mute flag. These exercise the client wiring (persistence + the
 * seenEventIds replay guard + the stranger gate) on top of the pure reducer in
 * conversations.ts — so they run against the real MobileClient, not applyChatInbound.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeChatInvite, makeChatMsg } from '@freeport/protocol';

// client.ts pulls native/relay-coupled modules at import time (see client-block.test.ts).
vi.mock('../src/kv', () => ({
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => {}),
  kvDelete: vi.fn(async () => {}),
  profileId: () => '',
  storagePrefix: () => '',
  storageKey: (k: string) => k,
}));
vi.mock('../src/profile', () => ({
  publishProfile: vi.fn(async () => {}),
  maskPhone: (s: string) => s,
}));
vi.mock('../src/karma', () => ({ publishKarma: vi.fn(async () => {}) }));
// Persistence backend — spy so we can assert (and to keep it off the filesystem).
const kvCacheSet = vi.fn(async (_key: string, _value: string) => {});
vi.mock('../src/kvCache', () => ({
  kvCacheGet: vi.fn(async () => null),
  kvCacheSet: (key: string, value: string) => kvCacheSet(key, value),
  kvCacheDelete: vi.fn(async () => {}),
}));

import { MobileClient } from '../src/client';
import { newConversation, type Conversation } from '../src/conversations';

const PEER = 'a'.repeat(64);
const ME = 'f'.repeat(64);

function makeClient(): MobileClient {
  const client = new MobileClient({ pubkey: ME } as any, ['wss://relay.example']);
  // Pre-mark the peer's profile so processChatDM's fetchProfile is a no-op
  // (avoids scheduling a real relay subscription timer).
  (client as any).profiles.set(PEER, {});
  return client;
}

function seed(client: MobileClient, over: Partial<Conversation>): Conversation {
  const conv: Conversation = { ...newConversation(PEER, 'active'), ...over };
  (client as any).conversations.set(PEER, conv);
  return conv;
}

const convOf = (client: MobileClient): Conversation | undefined =>
  (client as any).conversations.get(PEER);

const inbound = (client: MobileClient, env: unknown, eventId: string, createdAt = Math.floor(Date.now() / 1000)) =>
  (client as any).processChatDM(env, PEER, createdAt, eventId);

describe('chatClearMessages', () => {
  let client: MobileClient;
  beforeEach(() => { client = makeClient(); kvCacheSet.mockClear(); });

  it('empties messages but preserves state and the seenEventIds replay guard', () => {
    seed(client, {
      messages: [{ dir: 'in', text: 'hi', ts: 1, id: 'ev-old' }],
      seenEventIds: ['ev-old'],
    });
    client.chatClearMessages(PEER);
    const conv = convOf(client)!;
    expect(conv.messages).toEqual([]);
    expect(conv.state).toBe('active');
    expect(conv.seenEventIds).toEqual(['ev-old']);
  });

  it('a relay replay of a cleared event does NOT resurrect the message', () => {
    seed(client, {
      messages: [{ dir: 'in', text: 'secret', ts: 1, id: 'ev-old' }],
      seenEventIds: ['ev-old'],
    });
    client.chatClearMessages(PEER);
    // Backfill replays the same rumor id that was cleared.
    inbound(client, makeChatMsg('secret'), 'ev-old');
    expect(convOf(client)!.messages).toEqual([]);
  });

  it('no-op on an empty or unknown conversation', () => {
    seed(client, { messages: [] });
    const notify = vi.fn();
    client.onConversationUpdate = notify;
    client.chatClearMessages(PEER);
    client.chatClearMessages('z'.repeat(64));
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('chatDeleteConversation', () => {
  let client: MobileClient;
  beforeEach(() => { vi.useFakeTimers(); client = makeClient(); kvCacheSet.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('removes the conversation and persists', () => {
    seed(client, { messages: [{ dir: 'in', text: 'hi', ts: 1, id: 'e1' }] });
    client.chatDeleteConversation(PEER);
    expect((client as any).conversations.has(PEER)).toBe(false);
    vi.advanceTimersByTime(300); // flush the debounced persist
    expect(kvCacheSet).toHaveBeenCalled();
    const persisted = JSON.parse(kvCacheSet.mock.calls[0][1] as string);
    expect(persisted).toEqual([]);
  });

  it('an inbound MESSAGE from the deleted peer is dropped by the stranger gate', () => {
    seed(client, {});
    client.chatDeleteConversation(PEER);
    inbound(client, makeChatMsg('you there?'), 'e2');
    expect((client as any).conversations.has(PEER)).toBe(false);
  });

  it('an inbound INVITE from the deleted peer recreates the thread as pending_in', () => {
    seed(client, {});
    client.chatDeleteConversation(PEER);
    inbound(client, makeChatInvite('Alice'), 'e3');
    expect(convOf(client)?.state).toBe('pending_in');
  });
});

describe('chatSetMuted (sticky) vs archived (cleared by activity)', () => {
  let client: MobileClient;
  beforeEach(() => { client = makeClient(); });

  it('sets and clears the mute flag', () => {
    seed(client, {});
    client.chatSetMuted(PEER, true);
    expect(convOf(client)!.muted).toBe(true);
    client.chatSetMuted(PEER, false);
    expect(convOf(client)!.muted).toBe(false);
  });

  it('new inbound activity does NOT clear mute, but DOES clear archived', () => {
    seed(client, { muted: true, archived: true });
    inbound(client, makeChatMsg('ping'), 'e4');
    const conv = convOf(client)!;
    expect(conv.muted).toBe(true);   // sticky
    expect(conv.archived).toBe(false); // resurfaced
    expect(conv.messages).toHaveLength(1);
  });
});
