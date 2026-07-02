/**
 * Multi-party contention: several bidders on one intent, exchanging REAL signed
 * + NIP-04-encrypted events through a shared in-process relay (only the network
 * is faked). Covers the two uncovered branches in client.ts:
 *   - the losing-bidder sweep (owner confirms one → cancels the rest), and
 *   - the racing-accept rejection (a late accept on an already-filled intent).
 * and asserts the losing bidder sees the listing withdrawn ("post disappears").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Heavy / React-Native-coupled collaborators are stubbed; signing + NIP-04 +
// negotiation logic + moderation stay real.
vi.mock('../src/kv', () => ({
  kvGet: vi.fn(async () => null),          // no persistence → no cross-client collision
  kvSet: vi.fn(async () => {}),
  kvDelete: vi.fn(async () => {}),
  profileId: () => '', storagePrefix: () => '', storageKey: (k: string) => k,
}));
vi.mock('../src/pow', () => ({ minePowAsync: async (e: any) => e }));
vi.mock('../src/profile', () => ({ publishProfile: vi.fn(async () => {}), maskPhone: (s: string) => s }));
vi.mock('../src/karma', () => ({ publishKarma: vi.fn(async () => {}) }));
vi.mock('../src/receipts', () => ({ publishReceipt: vi.fn(async () => {}) }));
vi.mock('../src/reputation', () => ({ fetchReputation: vi.fn(async () => ({})) }));
vi.mock('../src/wot', () => ({ buildTrustMap: vi.fn(async () => new Map()) }));

import { generateSecretKey } from 'nostr-tools/pure';
import { buildIntentEvent, parseIntentEvent, DEMO_MARKET, DEMO_SCHEMA, type Intent, type Negotiation } from '@freeport/protocol';
import { MobileClient } from '../src/client';
import { LocalSigner } from '../src/signer';
import { FakeRelay, flush } from './fake-relay';

const RELAY = ['ws://fake'];
const now = () => Math.floor(Date.now() / 1000);

interface Party { sk: Uint8Array; client: MobileClient; intents: Intent[]; negos: () => Negotiation[] }

function makeParty(relay: FakeRelay): Party {
  const sk = generateSecretKey();
  const client = new MobileClient(new LocalSigner(sk), RELAY);
  (client as any).pool = relay;
  const intents: Intent[] = [];
  client.onIntent = (i) => intents.push(i);
  client.onOwnIntent = (i) => intents.push(i);
  client.watchMarket(DEMO_MARKET);
  client.watchDMs();
  return { sk, client, intents, negos: () => [...client.negotiations.values()] };
}

/** Build + publish a signed intent from `owner`; returns the parsed intent. */
async function postIntent(relay: FakeRelay, owner: Party, side: 'request' | 'offer'): Promise<Intent> {
  const ev = buildIntentEvent(
    {
      side, market: DEMO_MARKET, schema: DEMO_SCHEMA,
      title: side === 'request' ? 'Ride Orchard → Hougang' : 'Driver free this evening',
      payload: { from: { name: 'Orchard' }, to: { name: 'Hougang' }, seats: 1 },
      window: { start: now() + 3600, end: now() + 5400 },
      expiresAt: now() + 7200,
      topics: [DEMO_MARKET],
    },
    owner.sk,
  );
  relay.publish([], ev);      // delivered to every watchMarket sub (incl. owner's own echo)
  await flush();
  return parseIntentEvent(ev)!;
}

const negoWith = (p: Party, peer: string) => p.negos().find((n) => n.peer === peer);
const sawWithdrawal = (p: Party, d: string) =>
  p.intents.some((i) => i.d === d && (i.content.payload as any)?.withdrawn === true);

let relay: FakeRelay;
beforeEach(() => { relay = new FakeRelay(); });

describe('one rider intent, two drivers — manual confirm sweeps the loser', () => {
  it('rider confirms one counter-offer; the other driver is cancelled and sees the post withdrawn', async () => {
    const rider = makeParty(relay);
    const driverA = makeParty(relay);
    const driverB = makeParty(relay);
    const intent = await postIntent(relay, rider, 'request');

    // Both drivers respond with a counter-offer (an OFFER against the rider's ride request).
    await driverA.client.respond(intent, { payment: 'SGD 20', window: intent.content.window }, 'tg:@alice');
    await driverB.client.respond(intent, { payment: 'SGD 22', window: intent.content.window }, 'tg:@bob');
    await flush();

    // Rider now has two OPEN negotiations, one per driver.
    const rA = negoWith(rider, driverA.client.pubkey)!;
    const rB = negoWith(rider, driverB.client.pubkey)!;
    expect(rA?.state).toBe('open');
    expect(rB?.state).toBe('open');

    // Rider accepts driver A.
    await rider.client.accept(rA.id, 'tg:@rider');
    await flush();

    // Rider side: A confirmed, B swept to cancelled.
    expect(rider.client.negotiations.get(rA.id)!.state).toBe('confirmed');
    expect(rider.client.negotiations.get(rB.id)!.state).toBe('cancelled');

    // Winner's client confirms; loser's client is cancelled with the sweep reason.
    expect(negoWith(driverA, rider.client.pubkey)!.state).toBe('confirmed');
    const lost = negoWith(driverB, rider.client.pubkey)!;
    expect(lost.state).toBe('cancelled');
    expect(lost.log.some((e) => e.msg?.reason === 'Filled — taken by another offer')).toBe(true);

    // The post disappears for the losing driver: the withdrawal tombstone arrives.
    expect(sawWithdrawal(driverB, intent.d)).toBe(true);
  });
});

describe('one rider intent, two drivers — one-tap accept, the later one is rejected', () => {
  it('first accept confirms; the racing second accept is cancelled, and that driver sees the post withdrawn', async () => {
    const rider = makeParty(relay);
    const driverA = makeParty(relay);
    const driverB = makeParty(relay);
    const intent = await postIntent(relay, rider, 'request');
    const terms = { payment: 'SGD 20', window: intent.content.window };

    // Driver A one-tap accepts and confirms first.
    await driverA.client.acceptIntent(intent, terms, 'tg:@alice');
    await flush();
    expect(negoWith(rider, driverA.client.pubkey)!.state).toBe('confirmed');

    // Driver B accepts a beat later — the rider's intent is already filled.
    await driverB.client.acceptIntent(intent, terms, 'tg:@bob');
    await flush();

    // Rider never opens a second deal; driver B is cancelled.
    expect(negoWith(rider, driverB.client.pubkey)!.state).toBe('cancelled');
    expect(negoWith(driverA, rider.client.pubkey)!.state).toBe('confirmed');
    const lost = negoWith(driverB, rider.client.pubkey)!;
    expect(lost.state).toBe('cancelled');
    expect(sawWithdrawal(driverB, intent.d)).toBe(true);
  });
});

describe('symmetric: one driver offer, two riders — owner=driver sweeps the loser', () => {
  it('driver confirms the first rider; the second rider is cancelled and sees the offer withdrawn', async () => {
    const driver = makeParty(relay);
    const riderA = makeParty(relay);
    const riderB = makeParty(relay);
    const offer = await postIntent(relay, driver, 'offer');
    const terms = { payment: 'SGD 20', window: offer.content.window };

    await riderA.client.acceptIntent(offer, terms, 'tg:@riderA');
    await flush();
    expect(negoWith(driver, riderA.client.pubkey)!.state).toBe('confirmed');

    await riderB.client.acceptIntent(offer, terms, 'tg:@riderB');
    await flush();

    expect(negoWith(driver, riderB.client.pubkey)!.state).toBe('cancelled');
    expect(negoWith(riderA, driver.client.pubkey)!.state).toBe('confirmed');
    expect(negoWith(riderB, driver.client.pubkey)!.state).toBe('cancelled');
    expect(sawWithdrawal(riderB, offer.d)).toBe(true);
  });
});
