/**
 * Negotiation-lifecycle e2e: multiple MobileClient "agents" exchanging real
 * signed + NIP-04-encrypted events through the shared in-process relay.
 * Where client-multiparty.test.ts covers WHO wins a contested intent, this
 * covers HOW deals live and die: counter ping-pong to the round ceiling,
 * cancelling the post mid-negotiation, declining, mutual cancellation,
 * completed-trip protection, late bids after fill, offline recovery, and the
 * outbox surviving a relay outage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/kv', () => ({
  kvGet: vi.fn(async () => null),          // no persistence → each client starts clean
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

function makeParty(relay: FakeRelay, sk = generateSecretKey()): Party {
  const client = new MobileClient(new LocalSigner(sk), RELAY);
  (client as any).pool = relay;
  const intents: Intent[] = [];
  client.onIntent = (i) => intents.push(i);
  client.onOwnIntent = (i) => intents.push(i);
  client.watchMarket(DEMO_MARKET);
  client.watchDMs();
  return { sk, client, intents, negos: () => [...client.negotiations.values()] };
}

async function postIntent(relay: FakeRelay, owner: Party): Promise<Intent> {
  const ev = buildIntentEvent(
    {
      side: 'request', market: DEMO_MARKET, schema: DEMO_SCHEMA,
      title: 'Ride Orchard → Hougang',
      payload: { from: { name: 'Orchard' }, to: { name: 'Hougang' }, seats: 1 },
      window: { start: now() + 3600, end: now() + 5400 },
      expiresAt: now() + 7200,
      topics: [DEMO_MARKET],
    },
    owner.sk,
  );
  relay.publish([], ev);
  await flush();
  return parseIntentEvent(ev)!;
}

const negoWith = (p: Party, peer: string) => p.negos().find((n) => n.peer === peer);
const sawWithdrawal = (p: Party, d: string) =>
  p.intents.some((i) => i.d === d && (i.content.payload as any)?.withdrawn === true);
const terms = (i: Intent, payment: string) => ({ payment, window: i.content.window });

let relay: FakeRelay;
beforeEach(() => { relay = new FakeRelay(); });

describe('counter ping-pong to the round ceiling', () => {
  it('the 9th counter throws, but accepting the terms on the table still closes the deal', async () => {
    const rider = makeParty(relay);
    const driver = makeParty(relay);
    const intent = await postIntent(relay, rider);

    await driver.client.respond(intent, terms(intent, 'SGD 30'), 'tg:@driver'); // round 1
    await flush();
    const riderNego = () => negoWith(rider, driver.client.pubkey)!;
    const driverNego = () => negoWith(driver, rider.client.pubkey)!;

    // Alternate counters until MAX_ROUNDS (8) is reached on both sides.
    const parties = [rider, driver];
    for (let round = 2; round <= 8; round++) {
      const p = parties[round % 2]; // rider counters even rounds, driver odd
      const nego = p === rider ? riderNego() : driverNego();
      await p.client.counter(nego.id, { payment: `SGD ${30 - round}` });
      await flush();
    }
    expect(riderNego().rounds).toBe(8);
    expect(driverNego().rounds).toBe(8);

    // Round 9 is refused — the runaway-agent guard.
    await expect(driver.client.counter(driverNego().id, { payment: 'SGD 21' }))
      .rejects.toThrow(/max negotiation rounds/);

    // Accepting what's on the table still works.
    await rider.client.accept(riderNego().id, 'tg:@rider');
    await flush();
    expect(riderNego().state).toBe('confirmed');
    expect(driverNego().state).toBe('confirmed');
    // The last-proposed price won the haggle.
    expect(riderNego().terms?.payment).toBe('SGD 22');
  });
});

describe('cancelling the post mid-negotiation', () => {
  it('sweeps the open bid and notifies the bidder, but a confirmed deal survives the withdrawal', async () => {
    const rider = makeParty(relay);
    const winner = makeParty(relay);
    const pending = makeParty(relay);
    const intent = await postIntent(relay, rider);

    // Winner one-tap accepts (confirmed); `pending` has an open counter-offer.
    await winner.client.acceptIntent(intent, terms(intent, 'SGD 20'), 'tg:@winner');
    await flush();
    // NOTE: confirming already withdrew the post + swept `pending`? No — pending
    // bids AFTER the confirm, exercising a bid on an already-withdrawn post is
    // the late-bid test below. Here the order is: confirm, THEN pending bids
    // would be swept — so instead make pending bid FIRST on a fresh intent.
    expect(negoWith(rider, winner.client.pubkey)!.state).toBe('confirmed');

    const intent2 = await postIntent(relay, rider);
    await pending.client.respond(intent2, terms(intent2, 'SGD 25'), 'tg:@pending');
    await flush();
    expect(negoWith(rider, pending.client.pubkey)!.state).toBe('open');

    // Rider cancels the second post while the bid is still open.
    await rider.client.withdrawIntent(intent2);
    await flush();

    // The open bid is cancelled on both sides, with the withdrawal reason…
    expect(negoWith(rider, pending.client.pubkey)!.state).toBe('cancelled');
    const lost = negoWith(pending, rider.client.pubkey)!;
    expect(lost.state).toBe('cancelled');
    expect(lost.log.some((e) => e.msg?.reason === 'Request cancelled')).toBe(true);
    // …and the bidder's feed receives the tombstone.
    expect(sawWithdrawal(pending, intent2.d)).toBe(true);
    // The earlier confirmed deal is untouched.
    expect(negoWith(rider, winner.client.pubkey)!.state).toBe('confirmed');
    expect(negoWith(winner, rider.client.pubkey)!.state).toBe('confirmed');
  });
});

describe('declined bidder cannot re-bid', () => {
  it('after a decline, respond() on the same intent returns null', async () => {
    const rider = makeParty(relay);
    const driver = makeParty(relay);
    const intent = await postIntent(relay, rider);

    await driver.client.respond(intent, terms(intent, 'SGD 20'), 'tg:@driver');
    await flush();
    await rider.client.decline(negoWith(rider, driver.client.pubkey)!.id);
    await flush();
    expect(negoWith(driver, rider.client.pubkey)!.state).toBe('cancelled');

    // The negotiation id is deterministic per (intent, bidder), so a declined
    // bidder cannot spam fresh offers on the same post.
    await expect(driver.client.respond(intent, terms(intent, 'SGD 15'), 'tg:@driver')).resolves.toBeNull();
    expect(negoWith(rider, driver.client.pubkey)!.state).toBe('cancelled');
  });
});

describe('mutual cancellation of a confirmed deal', () => {
  it('keepDeal reverts the first request on both sides; agreeCancel ends the second', async () => {
    const rider = makeParty(relay);
    const driver = makeParty(relay);
    const intent = await postIntent(relay, rider);
    await driver.client.acceptIntent(intent, terms(intent, 'SGD 20'), 'tg:@driver');
    await flush();
    const riderNego = () => negoWith(rider, driver.client.pubkey)!;
    const driverNego = () => negoWith(driver, rider.client.pubkey)!;
    expect(riderNego().state).toBe('confirmed');

    // Driver asks to cancel; rider keeps the deal → both back to confirmed.
    await driver.client.requestCancel(driverNego().id);
    await flush();
    expect(riderNego().state).toBe('cancel_requested');
    expect(riderNego().cancelRequestedBy).toBe('them');
    await rider.client.keepDeal(riderNego().id);
    await flush();
    expect(riderNego().state).toBe('confirmed');
    expect(driverNego().state).toBe('confirmed');

    // Rider asks this time; driver agrees → cancelled on both sides.
    await rider.client.requestCancel(riderNego().id);
    await flush();
    expect(driverNego().state).toBe('cancel_requested');
    await driver.client.agreeCancel(driverNego().id);
    await flush();
    expect(riderNego().state).toBe('cancelled');
    expect(driverNego().state).toBe('cancelled');
  });
});

describe('a completed trip refuses cancellation', () => {
  it('a cancel-request arriving after completion is ignored by the counterparty', async () => {
    const rider = makeParty(relay);
    const driver = makeParty(relay);
    const intent = await postIntent(relay, rider);
    await driver.client.acceptIntent(intent, terms(intent, 'SGD 20'), 'tg:@driver');
    await flush();
    const driverNego = () => negoWith(driver, rider.client.pubkey)!;

    await driver.client.setStage(driverNego().id, 'picked_up');
    await driver.client.setStage(driverNego().id, 'completed');
    await flush();
    expect(negoWith(rider, driver.client.pubkey)!.stage).toBe('completed');

    // Rider requests a cancel anyway (the UI guards this; the protocol must too).
    await rider.client.requestCancel(negoWith(rider, driver.client.pubkey)!.id);
    await flush();
    expect(driverNego().state).toBe('confirmed');   // not cancel_requested
    expect(driverNego().stage).toBe('completed');
  });
});

describe('late bids after the intent is filled', () => {
  it('a late COUNTER gets the same "Filled" cancel as a late accept (no dangling open bid)', async () => {
    const rider = makeParty(relay);
    const winner = makeParty(relay);
    const late = makeParty(relay);
    const intent = await postIntent(relay, rider);

    await winner.client.acceptIntent(intent, terms(intent, 'SGD 20'), 'tg:@winner');
    await flush();
    expect(negoWith(rider, winner.client.pubkey)!.state).toBe('confirmed');

    // A counter-offer lands AFTER the fill (bidder saw the post before the tombstone).
    await late.client.respond(intent, terms(intent, 'SGD 18'), 'tg:@late');
    await flush();

    const onOwner = negoWith(rider, late.client.pubkey)!;
    expect(onOwner.state).toBe('cancelled');          // not a dangling 'open' bid
    const lost = negoWith(late, rider.client.pubkey)!;
    expect(lost.state).toBe('cancelled');
    expect(lost.log.some((e) => e.msg?.reason === 'Filled — taken by another offer')).toBe(true);
  });
});

describe('offline loser recovers the outcome from backfill', () => {
  it('a bidder who was away during the fill rebuilds the loss + sees the tombstone on reconnect', async () => {
    const rider = makeParty(relay);
    const winner = makeParty(relay);
    const loserSk = generateSecretKey();
    const loserBefore = makeParty(relay, loserSk);
    const intent = await postIntent(relay, rider);

    // Loser bids, then goes offline (their client is simply gone).
    await loserBefore.client.respond(intent, terms(intent, 'SGD 25'), 'tg:@loser');
    await flush();

    // While away: winner accepts → rider confirms, sweeps the loser, withdraws the post.
    await winner.client.acceptIntent(intent, terms(intent, 'SGD 20'), 'tg:@winner');
    await flush();
    expect(negoWith(rider, loserBefore.client.pubkey)!.state).toBe('cancelled');

    // Loser reconnects on a fresh client (same key, empty local state): the
    // relay backfill replays the intent, the sweep cancel, and the tombstone.
    const loserAfter = makeParty(relay, loserSk);
    await flush();

    const rebuilt = negoWith(loserAfter, rider.client.pubkey)!;
    expect(rebuilt).toBeTruthy();
    expect(rebuilt.state).toBe('cancelled');
    expect(sawWithdrawal(loserAfter, intent.d)).toBe(true);
  });
});

describe('outbox: an accept sent during a relay outage delivers on reconnect', () => {
  it('queues while down, both sides confirm after flushOutbox', async () => {
    const rider = makeParty(relay);
    const driver = makeParty(relay);
    const intent = await postIntent(relay, rider);

    relay.down = true; // total outage
    await driver.client.acceptIntent(intent, terms(intent, 'SGD 20'), 'tg:@driver');
    await flush();
    expect(driver.client.outboxPending()).toBe(1);
    expect(negoWith(driver, rider.client.pubkey)!.state).toBe('confirmed'); // optimistic local
    expect(negoWith(rider, driver.client.pubkey)).toBeUndefined();          // nothing arrived

    relay.down = false;
    await driver.client.reconnect(); // flushes the outbox
    await flush();

    expect(driver.client.outboxPending()).toBe(0);
    expect(negoWith(rider, driver.client.pubkey)!.state).toBe('confirmed');
    expect(negoWith(rider, driver.client.pubkey)!.theirContact).toBe('tg:@driver');
  });
});
