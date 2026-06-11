import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
  buildIntentEvent,
  parseIntentEvent,
  buildWithdrawEvent,
  intentExpired,
  geohashEncode,
  geohashDecode,
  geohashNear,
  matchIntent,
  openNegotiation,
  makeCounter,
  makeAccept,
  makeCancel,
  applyOutbound,
  applyInbound,
  parseNegotiationMessage,
  KIND_INTENT_REQUEST,
  DEMO_MARKET,
  DEMO_SCHEMA,
  type MatchRule,
  type Intent,
} from '../src/index.js';

const skA = generateSecretKey();
const pkA = getPublicKey(skA);
const skB = generateSecretKey();
const pkB = getPublicKey(skB);

const ORCHARD = geohashEncode(1.3048, 103.8318, 6); // Orchard Rd
const HOUGANG = geohashEncode(1.3712, 103.8863, 6); // Hougang

function rideRequest(opts: { start?: number; end?: number; expires?: number } = {}): Intent {
  const now = Math.floor(Date.now() / 1000);
  const ev = buildIntentEvent(
    {
      side: 'request',
      market: DEMO_MARKET,
      schema: DEMO_SCHEMA,
      title: 'Ride Orchard → Hougang',
      payload: {
        from: { name: 'Orchard', geohash: ORCHARD },
        to: { name: 'Hougang', geohash: HOUGANG },
        seats: 1,
      },
      window: { start: opts.start ?? now + 3600, end: opts.end ?? now + 5400 },
      flexMinutes: 30,
      expiresAt: opts.expires ?? now + 86400,
      geohashes: [ORCHARD.slice(0, 5)],
    },
    skA,
  );
  const intent = parseIntentEvent(ev);
  expect(intent).not.toBeNull();
  return intent!;
}

describe('intent events', () => {
  it('builds and parses round-trip', () => {
    const intent = rideRequest();
    expect(intent.pubkey).toBe(pkA);
    expect(intent.content.market).toBe(DEMO_MARKET);
    expect(intent.content.side).toBe('request');
  });

  it('uses the request kind and carries expiration + market tags', () => {
    const now = Math.floor(Date.now() / 1000);
    const ev = buildIntentEvent(
      {
        side: 'request',
        market: DEMO_MARKET,
        schema: DEMO_SCHEMA,
        title: 't',
        payload: {},
        expiresAt: now + 60,
      },
      skA,
    );
    expect(ev.kind).toBe(KIND_INTENT_REQUEST);
    expect(ev.tags.find((t) => t[0] === 't')?.[1]).toBe(DEMO_MARKET);
    expect(ev.tags.find((t) => t[0] === 'expiration')?.[1]).toBe(String(now + 60));
  });

  it('rejects malformed content and kind/side mismatch', () => {
    const intent = rideRequest();
    const ev = buildIntentEvent(
      {
        side: 'offer',
        market: DEMO_MARKET,
        schema: DEMO_SCHEMA,
        title: 't',
        payload: {},
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      },
      skA,
    );
    // tamper: claim request in content but offer kind
    const tampered = { ...ev, content: JSON.stringify({ ...JSON.parse(ev.content), side: 'request' }) };
    expect(parseIntentEvent(tampered as any)).toBeNull();
    expect(parseIntentEvent({ ...ev, content: 'not json' } as any)).toBeNull();
    expect(intent).not.toBeNull();
  });

  it('withdraw republishes same d with passed expiry', () => {
    const intent = rideRequest();
    const w = buildWithdrawEvent(intent, skA);
    expect(w.tags.find((t) => t[0] === 'd')?.[1]).toBe(intent.d);
    const parsed = parseIntentEvent(w)!;
    expect(intentExpired(parsed)).toBe(true);
  });
});

describe('geohash', () => {
  it('round-trips within precision', () => {
    const { lat, lon } = geohashDecode(ORCHARD);
    expect(Math.abs(lat - 1.3048)).toBeLessThan(0.01);
    expect(Math.abs(lon - 103.8318)).toBeLessThan(0.01);
  });
  it('proximity by prefix', () => {
    expect(geohashNear(ORCHARD, ORCHARD)).toBe(true);
    expect(geohashNear(ORCHARD, HOUGANG)).toBe(false);
  });
});

describe('matching', () => {
  const driverRule: MatchRule = {
    schema: DEMO_SCHEMA,
    side: 'offer',
    market: DEMO_MARKET,
    route: { from_geohash: ORCHARD, to_geohash: HOUGANG },
    daily_window: { start: '00:00', end: '23:59' },
    flex_minutes: 30,
    contact: 'tg:@driver',
  };

  it('matches an opposing intent on the same route', () => {
    const res = matchIntent(rideRequest(), driverRule);
    expect(res.matched).toBe(true);
  });

  it('rejects same side', () => {
    const rule = { ...driverRule, side: 'request' as const };
    expect(matchIntent(rideRequest(), rule).matched).toBe(false);
  });

  it('rejects wrong route', () => {
    const rule = { ...driverRule, route: { from_geohash: 'u4pruy', to_geohash: 'u4pruz' } };
    expect(matchIntent(rideRequest(), rule).matched).toBe(false);
  });

  it('counters with a shifted time when windows do not overlap but flex allows', () => {
    // Driver only available 16:00–18:00; rider asks 15:00–15:30 with 30+30min flex.
    const day = new Date();
    day.setHours(15, 0, 0, 0);
    const start = Math.floor(day.getTime() / 1000);
    const intent = rideRequest({ start, end: start + 30 * 60 });
    const rule: MatchRule = { ...driverRule, daily_window: { start: '16:00', end: '18:00' }, flex_minutes: 30 };
    const res = matchIntent(intent, rule);
    expect(res.matched).toBe(true);
    expect(res.acceptAsIs).toBeFalsy();
    expect(res.counterTerms?.window?.start).toBeGreaterThan(start);
  });

  it('rejects when beyond flexibility', () => {
    const day = new Date();
    day.setHours(9, 0, 0, 0);
    const start = Math.floor(day.getTime() / 1000);
    const intent = rideRequest({ start, end: start + 30 * 60 });
    const rule: MatchRule = { ...driverRule, daily_window: { start: '16:00', end: '18:00' }, flex_minutes: 30 };
    expect(matchIntent(intent, rule).matched).toBe(false);
  });

  it('rejects expired intents', () => {
    const intent = rideRequest({ expires: Math.floor(Date.now() / 1000) - 10 });
    expect(matchIntent(intent, driverRule).matched).toBe(false);
  });
});

describe('negotiation state machine', () => {
  it('full happy path: counter → counter → accept ↔ accept = confirmed', () => {
    const intent = rideRequest();
    // B initiates against A's intent
    let b = openNegotiation(intent, pkB, true);
    let a = openNegotiation(intent, pkA, false, pkB);

    const now = Math.floor(Date.now() / 1000);
    const c1 = makeCounter(b, { window: { start: now + 7200, end: now + 9000 } });
    b = applyOutbound(b, c1);
    a = applyInbound(a, c1, pkB)!;
    expect(a.state).toBe('open');
    expect(a.terms?.window?.start).toBe(now + 7200);

    const c2 = makeCounter(a, { window: { start: now + 6000, end: now + 7800 } });
    a = applyOutbound(a, c2);
    b = applyInbound(b, c2, pkA)!;
    expect(b.rounds).toBe(2);

    const acc1 = makeAccept(b, 'tg:@bob');
    b = applyOutbound(b, acc1);
    expect(b.state).toBe('accepted_by_us');
    a = applyInbound(a, acc1, pkB)!;
    expect(a.state).toBe('accepted_by_them');
    expect(a.theirContact).toBe('tg:@bob');

    const acc2 = makeAccept(a, 'tg:@alice');
    a = applyOutbound(a, acc2);
    expect(a.state).toBe('confirmed');
    b = applyInbound(b, acc2, pkA)!;
    expect(b.state).toBe('confirmed');
    expect(b.theirContact).toBe('tg:@alice');
  });

  it('cancel terminates from either side', () => {
    const intent = rideRequest();
    let b = openNegotiation(intent, pkB, true);
    const c1 = makeCounter(b, { note: 'hi' });
    b = applyOutbound(b, c1);
    const cancel = makeCancel(b, 'changed my mind');
    b = applyOutbound(b, cancel);
    expect(b.state).toBe('cancelled');
    expect(() => makeAccept(b, 'x')).toThrow();
  });

  it('ignores messages from a third party', () => {
    const intent = rideRequest();
    let a = openNegotiation(intent, pkA, false, pkB);
    let b = openNegotiation(intent, pkB, true);
    const c1 = makeCounter(b, { note: 'hi' });
    applyOutbound(b, c1);
    a = applyInbound(a, c1, pkB)!;
    const mallory = getPublicKey(generateSecretKey());
    expect(applyInbound(a, makeCancel(b), mallory)).toBeNull();
  });

  it('ignores messages after terminal state', () => {
    const intent = rideRequest();
    let b = openNegotiation(intent, pkB, true);
    b = applyOutbound(b, makeCancel(b));
    expect(applyInbound(b, makeCounter({ ...b, state: 'open' }, { note: 'x' }), pkA)).toBeNull();
  });

  it('caps negotiation rounds', () => {
    const intent = rideRequest();
    let b = openNegotiation(intent, pkB, true);
    for (let i = 0; i < 8; i++) b = applyOutbound(b, makeCounter(b, { note: `r${i}` }));
    expect(() => makeCounter(b, { note: 'one too many' })).toThrow();
  });

  it('parses only valid envelopes', () => {
    expect(parseNegotiationMessage('garbage')).toBeNull();
    expect(parseNegotiationMessage('{"v":1,"type":"nope","nego":"x","intent_id":"y"}')).toBeNull();
    const intent = rideRequest();
    const b = openNegotiation(intent, pkB, true);
    const msg = makeCounter(b, { note: 'hi' });
    expect(parseNegotiationMessage(JSON.stringify(msg))?.type).toBe('negotiate.counter');
  });
});
