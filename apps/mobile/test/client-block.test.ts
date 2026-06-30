import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openNegotiation, makeChat, type Intent } from '@freeport/protocol';

// client.ts pulls in React-Native / Expo-coupled relative modules at import
// time. Stub the ones that reach native code so the module loads under Node:
//   ./kv      -> expo-secure-store (keychain)
//   ./profile -> ./cloudSync -> ./cloudBackup (react-native + expo-modules-core)
//   ./karma   -> ./i18n -> ./locales (large eager locale graph)
// None of these are exercised by processDM's block-drop path, so empty stubs
// are enough.
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
vi.mock('../src/karma', () => ({
  publishKarma: vi.fn(async () => {}),
}));

import { MobileClient } from '../src/client';

const BLOCKED = 'b'.repeat(64);
const PEER = 'a'.repeat(64);
const ME = 'f'.repeat(64);

function makeIntent(): Intent {
  return {
    id: 'intent-event-id',
    pubkey: ME, // our own intent -> peer is the responder (sender)
    d: 'intent-d-tag',
    createdAt: Math.floor(Date.now() / 1000),
    content: {
      v: 1,
      side: 'offer',
      market: 'rideshare',
      schema: 'rideshare/1',
      title: 'test',
      payload: {},
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    },
  };
}

/** A minimal signer stub — processDM never calls into it. */
function makeClient(): MobileClient {
  const signer = { pubkey: ME } as any;
  return new MobileClient(signer, ['wss://relay.example']);
}

describe('MobileClient inbound DM blocking', () => {
  let client: MobileClient;
  let intent: Intent;

  beforeEach(() => {
    client = makeClient();
    intent = makeIntent();
    // Seed an open negotiation whose peer is the (non-blocked) sender, so an
    // inbound chat from PEER mutates it and a chat from a blocked sender would
    // (were it not dropped) also have a thread to mutate.
    const nego = openNegotiation(intent, ME, false, PEER);
    (client as any).negotiations.set(nego.id, { ...nego, state: 'open' });
  });

  it('drops a DM from a blocked sender: no mutation, no notification', () => {
    client.setBlocked([BLOCKED]);
    const nego = [...client.negotiations.values()][0];

    const updates: unknown[] = [];
    const incoming: unknown[] = [];
    client.onNegotiationUpdate = (n) => updates.push(n);
    client.onIncomingMessage = (n, m) => incoming.push(m);

    // A blocked sender sends a chat into the existing thread.
    const chat = makeChat(nego, 'hello from blocked peer');
    const before = JSON.stringify([...client.negotiations.entries()]);
    const sizeBefore = client.negotiations.size;

    (client as any).processDM(chat, BLOCKED, Math.floor(Date.now() / 1000), false, 'evt-blocked');

    // Nothing created, nothing mutated, no callback fired.
    expect(client.negotiations.size).toBe(sizeBefore);
    expect(JSON.stringify([...client.negotiations.entries()])).toBe(before);
    expect(updates).toHaveLength(0);
    expect(incoming).toHaveLength(0);
  });

  it('processes a DM from a non-blocked sender: mutates the negotiation and notifies', () => {
    client.setBlocked([BLOCKED]); // PEER is NOT in the blocked set
    const nego = [...client.negotiations.values()][0];

    const updates: any[] = [];
    const incoming: any[] = [];
    client.onNegotiationUpdate = (n) => updates.push(n);
    client.onIncomingMessage = (n, m) => incoming.push(m);

    const chat = makeChat(nego, 'hello from real peer');
    // watchStartTs defaults to 0, and createdAt >= watchStartTs - 5, so the
    // live-notification branch fires.
    (client as any).processDM(chat, PEER, Math.floor(Date.now() / 1000), false, 'evt-peer');

    const after = client.negotiations.get(nego.id)!;
    expect(after.messages?.some((m: any) => m.text === 'hello from real peer')).toBe(true);
    expect(updates).toHaveLength(1);
    expect(incoming).toHaveLength(1);
  });
});
