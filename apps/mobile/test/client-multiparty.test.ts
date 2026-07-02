/**
 * Multi-party contention: several bidders on one intent, exchanging REAL signed
 * + NIP-04-encrypted events through a shared in-process relay (only the network
 * is faked). Covers the two contested-intent branches in client.ts:
 *   - the losing-bidder sweep (owner confirms one → cancels the rest), and
 *   - the racing-accept rejection (a late accept on an already-filled intent),
 * asserting the losing bidder sees the listing withdrawn ("post disappears").
 *
 * Run across BOTH verticals (rideshare and service/product) to prove the logic
 * is schema-independent — the sweep/racing code lives in the client, not the
 * per-vertical matcher.
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
import {
  buildIntentEvent, parseIntentEvent,
  DEMO_MARKET, DEMO_SCHEMA, SERVICE_MARKET, SERVICE_SCHEMA,
  type Intent, type Negotiation, type ProposedTerms, type TimeWindow,
} from '@freeport/protocol';
import { MobileClient } from '../src/client';
import { LocalSigner } from '../src/signer';
import { FakeRelay, flush } from './fake-relay';

const RELAY = ['ws://fake'];
const now = () => Math.floor(Date.now() / 1000);

interface Party { sk: Uint8Array; client: MobileClient; intents: Intent[]; negos: () => Negotiation[] }

function makeParty(relay: FakeRelay, market: string): Party {
  const sk = generateSecretKey();
  const client = new MobileClient(new LocalSigner(sk), RELAY);
  (client as any).pool = relay;
  const intents: Intent[] = [];
  client.onIntent = (i) => intents.push(i);
  client.onOwnIntent = (i) => intents.push(i);
  client.watchMarket(market);
  client.watchDMs();
  return { sk, client, intents, negos: () => [...client.negotiations.values()] };
}

interface Vertical {
  name: string;
  market: string;
  schema: string;
  payload: Record<string, unknown>;
  terms: (w?: TimeWindow) => ProposedTerms;
  requestTitle: string;
  offerTitle: string;
  reqOwner: string;   // posts a request
  reqBidder: string;  // bids on a request
  offOwner: string;   // posts an offer
  offBidder: string;  // bids on an offer
}

const VERTICALS: Vertical[] = [
  {
    name: 'rideshare',
    market: DEMO_MARKET, schema: DEMO_SCHEMA,
    payload: { from: { name: 'Orchard' }, to: { name: 'Hougang' }, seats: 1 },
    terms: (w) => ({ payment: 'SGD 20', window: w }),
    requestTitle: 'Ride Orchard → Hougang', offerTitle: 'Driver free this evening',
    reqOwner: 'rider', reqBidder: 'driver', offOwner: 'driver', offBidder: 'rider',
  },
  {
    name: 'service',
    market: SERVICE_MARKET, schema: SERVICE_SCHEMA,
    payload: { service: 'Leaky tap repair', location: { name: 'Hanoi' }, category: 'Home Services' },
    terms: (w) => ({ payment: 'USD 50', service: 'Leaky tap repair', window: w }),
    requestTitle: 'Need a plumber this week', offerTitle: 'Plumber available this week',
    reqOwner: 'consumer', reqBidder: 'provider', offOwner: 'provider', offBidder: 'consumer',
  },
];

async function postIntent(relay: FakeRelay, v: Vertical, owner: Party, side: 'request' | 'offer'): Promise<Intent> {
  const ev = buildIntentEvent(
    {
      side, market: v.market, schema: v.schema,
      title: side === 'request' ? v.requestTitle : v.offerTitle,
      payload: v.payload,
      window: { start: now() + 3600, end: now() + 5400 },
      expiresAt: now() + 7200,
      topics: [v.market],
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

for (const v of VERTICALS) {
  describe(`${v.name}: one ${v.reqOwner} request, two ${v.reqBidder}s — manual confirm sweeps the loser`, () => {
    it(`${v.reqOwner} accepts one counter-offer; the other ${v.reqBidder} is cancelled and sees the post withdrawn`, async () => {
      const owner = makeParty(relay, v.market);
      const bidA = makeParty(relay, v.market);
      const bidB = makeParty(relay, v.market);
      const intent = await postIntent(relay, v, owner, 'request');

      await bidA.client.respond(intent, v.terms(intent.content.window), 'tg:@a');
      await bidB.client.respond(intent, v.terms(intent.content.window), 'tg:@b');
      await flush();

      const rA = negoWith(owner, bidA.client.pubkey)!;
      const rB = negoWith(owner, bidB.client.pubkey)!;
      expect(rA?.state).toBe('open');
      expect(rB?.state).toBe('open');

      await owner.client.accept(rA.id, 'tg:@owner');
      await flush();

      expect(owner.client.negotiations.get(rA.id)!.state).toBe('confirmed');
      expect(owner.client.negotiations.get(rB.id)!.state).toBe('cancelled');
      expect(negoWith(bidA, owner.client.pubkey)!.state).toBe('confirmed');

      const lost = negoWith(bidB, owner.client.pubkey)!;
      expect(lost.state).toBe('cancelled');
      expect(lost.log.some((e) => e.msg?.reason === 'Filled — taken by another offer')).toBe(true);
      expect(sawWithdrawal(bidB, intent.d)).toBe(true);
    });
  });

  describe(`${v.name}: one ${v.reqOwner} request, two ${v.reqBidder}s — racing one-tap accept`, () => {
    it(`first accept confirms; the racing second is cancelled and that ${v.reqBidder} sees the post withdrawn`, async () => {
      const owner = makeParty(relay, v.market);
      const bidA = makeParty(relay, v.market);
      const bidB = makeParty(relay, v.market);
      const intent = await postIntent(relay, v, owner, 'request');

      await bidA.client.acceptIntent(intent, v.terms(intent.content.window), 'tg:@a');
      await flush();
      expect(negoWith(owner, bidA.client.pubkey)!.state).toBe('confirmed');

      await bidB.client.acceptIntent(intent, v.terms(intent.content.window), 'tg:@b');
      await flush();

      expect(negoWith(owner, bidB.client.pubkey)!.state).toBe('cancelled');
      expect(negoWith(bidA, owner.client.pubkey)!.state).toBe('confirmed');
      expect(negoWith(bidB, owner.client.pubkey)!.state).toBe('cancelled');
      expect(sawWithdrawal(bidB, intent.d)).toBe(true);
    });
  });

  describe(`${v.name}: one ${v.offOwner} offer, two ${v.offBidder}s — owner sweeps the loser`, () => {
    it(`${v.offOwner} confirms the first ${v.offBidder}; the second is cancelled and sees the offer withdrawn`, async () => {
      const owner = makeParty(relay, v.market);
      const bidA = makeParty(relay, v.market);
      const bidB = makeParty(relay, v.market);
      const offer = await postIntent(relay, v, owner, 'offer');

      await bidA.client.acceptIntent(offer, v.terms(offer.content.window), 'tg:@a');
      await flush();
      expect(negoWith(owner, bidA.client.pubkey)!.state).toBe('confirmed');

      await bidB.client.acceptIntent(offer, v.terms(offer.content.window), 'tg:@b');
      await flush();

      expect(negoWith(owner, bidB.client.pubkey)!.state).toBe('cancelled');
      expect(negoWith(bidA, owner.client.pubkey)!.state).toBe('confirmed');
      expect(negoWith(bidB, owner.client.pubkey)!.state).toBe('cancelled');
      expect(sawWithdrawal(bidB, offer.d)).toBe(true);
    });
  });
}
