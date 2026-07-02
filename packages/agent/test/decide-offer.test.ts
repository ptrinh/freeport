/**
 * The decideOffer extension (guest-bridge mode): when an AgentEvents supplies
 * decideOffer, every inbound counter on our own posted intent is routed to it
 * (accept / counter / decline) instead of the rule-based auto-negotiation — and
 * a shared relay pool lets many such agents run on one socket set.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SimplePool } from 'nostr-tools/pool';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
  buildIntentEvent, parseIntentEvent, openNegotiation, makeCounter, applyOutbound,
  DEMO_MARKET, DEMO_SCHEMA, type Intent, type Negotiation, type OfferDecision,
} from '@freeport/protocol';
import { Transport } from '../src/transport.js';
import { FreeportAgent, type OfferDecision as AgentOfferDecision } from '../src/agent.js';
import { startMiniRelay } from './mini-relay.js';

const PORT = 18802;
const RELAY = `ws://127.0.0.1:${PORT}`;
const now = () => Math.floor(Date.now() / 1000);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let relay: { close: () => void };
beforeAll(() => { relay = startMiniRelay(PORT); });
afterAll(() => relay.close());

function guestRequest(skGuest: Uint8Array): Intent {
  const ev = buildIntentEvent({
    side: 'request', market: DEMO_MARKET, schema: DEMO_SCHEMA, title: 'Ride A → B',
    payload: { from: { name: 'A' }, to: { name: 'B' }, seats: 1 },
    window: { start: now() + 3600, end: now() + 5400 }, expiresAt: now() + 7200,
  }, skGuest);
  return parseIntentEvent(ev)!;
}

/** Drive a "driver" that sends one counter to the guest and reports confirmation. */
function driver(sk: Uint8Array, pool: SimplePool) {
  const t = new Transport(sk, [RELAY], pool);
  let confirmed: Negotiation | null = null;
  t.subscribeNegotiations((msg, from, id) => {
    // The driver only needs to observe the guest's accept to know it's sealed.
  });
  return {
    pubkey: t.pubkey,
    async counter(intent: Intent, terms: any) {
      const nego = openNegotiation(intent, t.pubkey, true, intent.pubkey);
      const msg = makeCounter(nego, terms);
      await t.sendNegotiation(intent.pubkey, msg);
    },
    onConfirm(cb: (n: Negotiation) => void) {
      t.subscribeNegotiations((msg, from, id) => {
        if (msg.type === 'negotiate.accept') cb(msg as any);
      });
    },
    close: () => t.close(),
  };
}

describe('decideOffer guest-bridge routing', () => {
  it('routes an inbound counter to decideOffer and seals on accept', async () => {
    const pool = new SimplePool();
    const skGuest = generateSecretKey();
    const tGuest = new Transport(skGuest, [RELAY], pool);
    const intent = guestRequest(skGuest);

    const offers: Negotiation[] = [];
    let deal: Negotiation | null = null;
    const decide = async (n: Negotiation): Promise<AgentOfferDecision> => { offers.push(n); return { action: 'accept' }; };
    const agent = new FreeportAgent(tGuest, { name: 'guest', relays: [RELAY], markets: [], rules: [], contact: 'tg:@guest' }, {
      onLog: () => {}, confirmDeal: async () => true, onDeal: (n) => { deal = n; }, decideOffer: decide,
    });
    agent.registerPublishedIntent(intent);
    agent.start();

    const skDriver = generateSecretKey();
    const drv = driver(skDriver, pool);
    let driverGotAccept = false;
    drv.onConfirm(() => { driverGotAccept = true; });
    await wait(200);

    await drv.counter(intent, { payment: 'SGD 20', window: intent.content.window });
    await wait(500);

    expect(offers.length).toBe(1);                    // decideOffer fired for the counter
    expect(offers[0].peer).toBe(drv.pubkey);
    expect(deal).toBeTruthy();                         // onDeal fired (sealed)
    expect((deal as any).state).toBe('confirmed');
    expect((deal as any).theirContact).toBeUndefined(); // driver only countered; no contact yet
    expect(driverGotAccept).toBe(true);                // guest's accept reached the driver

    agent.stop(); tGuest.close(); drv.close(); pool.close([RELAY]);
  }, 15000);

  it('declines when decideOffer says decline', async () => {
    const pool = new SimplePool();
    const skGuest = generateSecretKey();
    const tGuest = new Transport(skGuest, [RELAY], pool);
    const intent = guestRequest(skGuest);
    let deal: Negotiation | null = null;
    const agent = new FreeportAgent(tGuest, { name: 'guest', relays: [RELAY], markets: [], rules: [], contact: 'tg:@g' }, {
      onLog: () => {}, confirmDeal: async () => true, onDeal: (n) => { deal = n; },
      decideOffer: async () => ({ action: 'decline', reason: 'no thanks' }),
    });
    agent.registerPublishedIntent(intent);
    agent.start();

    const drv = driver(generateSecretKey(), pool);
    let cancelled = false;
    drv.onConfirm(() => {});
    const t2 = new Transport(generateSecretKey(), [RELAY], pool);
    await wait(200);
    await drv.counter(intent, { payment: 'SGD 20', window: intent.content.window });
    await wait(400);
    expect(deal).toBeNull(); // never sealed
    agent.stop(); tGuest.close(); drv.close(); t2.close(); pool.close([RELAY]);
  }, 15000);

  it('a shared pool is not closed when one Transport closes', () => {
    const pool = new SimplePool();
    const a = new Transport(generateSecretKey(), [RELAY], pool);
    const b = new Transport(generateSecretKey(), [RELAY], pool);
    a.close(); // owns nothing — pool must stay usable for b
    expect(b.pool).toBe(pool);
    b.close(); pool.close([RELAY]);
  });
});
