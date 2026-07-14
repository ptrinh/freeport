/**
 * NIP-17 gift-wrap transport for friend chat + calls: after the NIP-04
 * handshake exchanges the `n17` capability, post-handshake traffic rides
 * kind-1059 wraps — relays stop seeing sender identity, timing, or that the
 * two pubkeys talk at all. Real seals/wraps (nostr-tools nip59), only the
 * network faked.
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

import { generateSecretKey, type Event } from 'nostr-tools/pure';
import { makeCallOffer, mintCallId, type CallEnvelope } from '@freeport/protocol';
import { MobileClient } from '../src/client';
import { LocalSigner } from '../src/signer';
import { FakeRelay, flush } from './fake-relay';

const RELAY = ['ws://fake'];

function makeUser(relay: FakeRelay) {
  const client = new MobileClient(new LocalSigner(generateSecretKey()), RELAY);
  (client as any).pool = relay;
  const signals: Array<{ from: string; env: CallEnvelope }> = [];
  client.onCallSignal = (from, env) => signals.push({ from, env });
  client.watchDMs();
  return { client, signals, convs: () => [...client.conversations.values()] };
}

/** Wire spy: count events by kind as they hit the relay (one sub per
 *  filter — the real subscribeMany takes a single Filter). */
function kindSpy(relay: FakeRelay) {
  const counts = new Map<number, number>();
  const onevent = (ev: Event) => counts.set(ev.kind, (counts.get(ev.kind) ?? 0) + 1);
  relay.subscribeMany(RELAY, { kinds: [4] } as any, { onevent });
  relay.subscribeMany(RELAY, { kinds: [1059] } as any, { onevent });
  return (kind: number) => counts.get(kind) ?? 0;
}

async function activePair(relay: FakeRelay) {
  const alice = makeUser(relay);
  const bob = makeUser(relay);
  await bob.client.chatInvite(alice.client.pubkey, 'Bob');
  await flush();
  await alice.client.chatAccept(bob.client.pubkey, 'Alice');
  await flush();
  return { alice, bob };
}

describe('NIP-17 transport upgrade', () => {
  it('handshake rides NIP-04 and exchanges n17; messages then ride kind 1059', async () => {
    const relay = new FakeRelay();
    const kinds = kindSpy(relay);
    const { alice, bob } = await activePair(relay);
    // Both sides learned the peer's capability (LocalSigner → always true).
    expect(alice.convs()[0].nip17).toBe(true);
    expect(bob.convs()[0].nip17).toBe(true);
    const dmCountAfterHandshake = kinds(4);

    await bob.client.chatSend(alice.client.pubkey, 'wrapped hello');
    await flush();
    expect(kinds(1059)).toBe(1);                    // the message is a wrap…
    expect(kinds(4)).toBe(dmCountAfterHandshake);   // …and NOT a kind-4 DM
    const msg = alice.convs()[0].messages[0];
    expect(msg?.text).toBe('wrapped hello');
    // Rumor id is the shared identifier: sender stored the same id.
    expect(bob.convs()[0].messages[0].id).toBe(msg.id);
  });

  it('receipts and call signaling ride the wrap too', async () => {
    const relay = new FakeRelay();
    const kinds = kindSpy(relay);
    const { alice, bob } = await activePair(relay);
    const kind4Base = kinds(4);

    // Receipts (bob acks alice's message).
    bob.client.setChatPrefs({ receipts: true, lastSeen: false });
    await alice.client.chatSend(bob.client.pubkey, 'ack me');
    await flush();
    await new Promise((r) => setTimeout(r, 400)); // coalesced ack timer
    await flush();
    expect(alice.convs()[0].theirDeliveredTs).toBeGreaterThan(0);

    // Call offer.
    await bob.client.sendCallSignal(alice.client.pubkey, makeCallOffer(mintCallId(), 'sdp', false));
    await flush();
    expect(alice.signals).toHaveLength(1);
    expect(kinds(4)).toBe(kind4Base); // nothing above rode kind 4
    expect(kinds(1059)).toBeGreaterThanOrEqual(3); // msg + ack + offer
  });

  it('falls back to NIP-04 when the peer lacks the capability', async () => {
    const relay = new FakeRelay();
    const kinds = kindSpy(relay);
    const { alice, bob } = await activePair(relay);
    // Simulate a legacy peer: bob's view of alice says no NIP-17.
    (bob.client.conversations.get(alice.client.pubkey) as any).nip17 = false;
    await bob.client.chatSend(alice.client.pubkey, 'legacy path');
    await flush();
    expect(kinds(1059)).toBe(0);
    expect(alice.convs()[0].messages[0]?.text).toBe('legacy path');
  });

  it('blocked peers are dropped AFTER unwrap (wrap authors are throwaway keys)', async () => {
    const relay = new FakeRelay();
    const { alice, bob } = await activePair(relay);
    alice.client.setBlocked([bob.client.pubkey]);
    await bob.client.chatSend(alice.client.pubkey, 'should not arrive');
    await flush();
    expect(alice.convs()[0].messages).toHaveLength(0);
  });
});
