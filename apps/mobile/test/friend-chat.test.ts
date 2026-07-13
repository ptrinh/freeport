/**
 * Friend chat end-to-end: two MobileClients exchanging REAL signed +
 * NIP-04-encrypted chat envelopes through the in-process FakeRelay — invite
 * publish/resolve (including the hijack case the hash commitment kills),
 * handshake, messaging, receipts, blocking, and rotation.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/kv', () => {
  const store = new Map<string, string>();
  return {
    kvGet: vi.fn(async (k: string) => store.get(k) ?? null),
    kvSet: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    kvDelete: vi.fn(async (k: string) => { store.delete(k); }),
    profileId: () => '', storagePrefix: () => '', storageKey: (k: string) => k,
  };
});
vi.mock('../src/pow', () => ({ minePowAsync: async (e: any) => e }));
vi.mock('../src/profile', () => ({ publishProfile: vi.fn(async () => {}), maskPhone: (s: string) => s }));
vi.mock('../src/karma', () => ({ publishKarma: vi.fn(async () => {}) }));
vi.mock('../src/receipts', () => ({ publishReceipt: vi.fn(async () => {}) }));
vi.mock('../src/reputation', () => ({ fetchReputation: vi.fn(async () => ({})) }));
vi.mock('../src/wot', () => ({ buildTrustMap: vi.fn(async () => new Map()) }));

import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { KIND_CHAT_INVITE, inviteCodeFor } from '@freeport/protocol';
import { MobileClient } from '../src/client';
import { LocalSigner } from '../src/signer';
import { FakeRelay, flush } from './fake-relay';
import type { Conversation } from '../src/conversations';

const RELAY = ['ws://fake'];

function makeUser(relay: FakeRelay) {
  const sk = generateSecretKey();
  const client = new MobileClient(new LocalSigner(sk), RELAY);
  (client as any).pool = relay;
  const convs = () => [...client.conversations.values()];
  client.watchDMs();
  return { sk, client, convs };
}

/** Wait past the coalesced delivered-ack timer (CHAT_ACK_DELAY_MS = 300). */
const flushAcks = () => new Promise((r) => setTimeout(r, 400));

describe('invite publish + resolve', () => {
  it('resolves a published invite to the inviter, and a rotated one stops resolving', async () => {
    const relay = new FakeRelay();
    const alice = makeUser(relay);
    const { code } = await alice.client.publishChatInvite('Alice');
    await flush();

    const bob = makeUser(relay);
    const r = await bob.client.resolveChatInvite(code);
    expect(r?.pubkey).toBe(alice.client.pubkey);
    expect(r?.name).toBe('Alice');

    // Rotation tombstones the old code and mints a new one.
    const { code: fresh } = await alice.client.rotateChatInvite('Alice');
    expect(fresh).not.toBe(code);
    await flush();
    expect(await bob.client.resolveChatInvite(code)).toBeNull();
    expect((await bob.client.resolveChatInvite(fresh))?.pubkey).toBe(alice.client.pubkey);
  });

  it('discards a hijacked code: same d-tag republished under another key', async () => {
    const relay = new FakeRelay();
    const alice = makeUser(relay);
    const { code } = await alice.client.publishChatInvite('Alice');
    await flush();

    // Mallory republishes Alice's code (and even a matching-format nonce)
    // under her OWN key — newer created_at, so a naive resolver picks it.
    const mallorySk = generateSecretKey();
    const evil = finalizeEvent({
      kind: KIND_CHAT_INVITE,
      created_at: Math.floor(Date.now() / 1000) + 10,
      tags: [['d', code], ['expiration', String(Math.floor(Date.now() / 1000) + 3600)]],
      content: JSON.stringify({ v: 1, nonce: 'ab'.repeat(16), name: 'Alice' }),
    }, mallorySk);
    relay.publish(RELAY, evil);
    await flush();

    const bob = makeUser(relay);
    const r = await bob.client.resolveChatInvite(code);
    expect(r?.pubkey).toBe(alice.client.pubkey); // commitment filters Mallory out
    expect(r?.pubkey).not.toBe(getPublicKey(mallorySk));

    // Sanity: the commitment really is what saves us.
    expect(inviteCodeFor(getPublicKey(mallorySk), 'ab'.repeat(16))).not.toBe(code);
  });
});

describe('handshake + messaging', () => {
  async function activePair() {
    const relay = new FakeRelay();
    const alice = makeUser(relay);
    const bob = makeUser(relay);
    // Bob opened Alice's invite link → sends the chat invite.
    await bob.client.chatInvite(alice.client.pubkey, 'Bob');
    await flush();
    expect(alice.convs()[0]?.state).toBe('pending_in');
    expect(alice.convs()[0]?.name).toBe('Bob');
    await alice.client.chatAccept(bob.client.pubkey, 'Alice');
    await flush();
    expect(alice.convs()[0]?.state).toBe('active');
    expect(bob.convs()[0]?.state).toBe('active');
    return { relay, alice, bob };
  }

  it('invite → accept → both active → messages flow with replay-safe ids', async () => {
    const { alice, bob } = await activePair();
    await alice.client.chatSend(bob.client.pubkey, 'hello Bob');
    await bob.client.chatSend(alice.client.pubkey, 'hi Alice');
    await flush();
    const aliceConv = alice.convs()[0];
    const bobConv = bob.convs()[0];
    expect(aliceConv.messages.map((m) => m.text).sort()).toEqual(['hello Bob', 'hi Alice']);
    expect(bobConv.messages.map((m) => m.text).sort()).toEqual(['hello Bob', 'hi Alice']);
    expect(bobConv.messages.find((m) => m.dir === 'in')?.id).toBeTruthy(); // dedupe key
  });

  it('reject drops the conversation on the rejector and tombstones the inviter', async () => {
    const relay = new FakeRelay();
    const alice = makeUser(relay);
    const bob = makeUser(relay);
    await bob.client.chatInvite(alice.client.pubkey, 'Bob');
    await flush();
    await alice.client.chatReject(bob.client.pubkey);
    await flush();
    expect(alice.convs()).toHaveLength(0);
    expect(bob.convs()[0]?.state).toBe('rejected');
  });

  it('blocked peers cannot message (dropped before decrypt)', async () => {
    const { alice, bob } = await activePair();
    alice.client.setBlocked([bob.client.pubkey]);
    await bob.client.chatSend(alice.client.pubkey, 'you cannot see this');
    await flush();
    expect(alice.convs()[0].messages).toHaveLength(0);
  });

  it('receipts: delivered ack flows only when receipts are ON, and read ack on open', async () => {
    const { alice, bob } = await activePair();
    // Receipts OFF (default): no ack comes back.
    await alice.client.chatSend(bob.client.pubkey, 'no receipts');
    await flush(); await flushAcks(); await flush();
    expect(alice.convs()[0].theirDeliveredTs).toBeUndefined();

    // Bob turns receipts on → the next message is acked as delivered.
    bob.client.setChatPrefs({ receipts: true, lastSeen: true });
    await alice.client.chatSend(bob.client.pubkey, 'with receipts');
    await flush(); await flushAcks(); await flush();
    const acked = alice.convs()[0];
    expect(acked.theirDeliveredTs).toBeGreaterThan(0);
    expect(acked.theirLastSeen).toBeGreaterThan(0); // lastSeen rides the ack

    // Bob opens the thread → read ack.
    bob.client.markChatRead(alice.client.pubkey);
    await flush();
    expect(alice.convs()[0].theirReadTs).toBeGreaterThan(0);
  });

  it('conversations persist and reload', async () => {
    const { alice, bob } = await activePair();
    await bob.client.chatSend(alice.client.pubkey, 'persist me');
    await flush();
    await new Promise((r) => setTimeout(r, 300)); // debounced persist
    const clone = new MobileClient((alice.client as any).signer, RELAY);
    await clone.loadConversations();
    const conv = clone.conversations.get(bob.client.pubkey) as Conversation;
    expect(conv?.state).toBe('active');
    expect(conv?.messages.some((m) => m.text === 'persist me')).toBe(true);
  });
});
