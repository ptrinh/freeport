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
  makeCancelRequest,
  makeCancelDecline,
  makeStatus,
  makeChat,
  applyOutbound,
  applyInbound,
  dedupeMessages,
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

  it('withdraw republishes same d with a short FUTURE expiry (not born-expired)', () => {
    const intent = rideRequest();
    const w = buildWithdrawEvent(intent, skA);
    expect(w.tags.find((t) => t[0] === 'd')?.[1]).toBe(intent.d);
    const parsed = parseIntentEvent(w)!;
    // Must NOT be born-expired — a NIP-40 relay drops expiration<=now, so a
    // born-now tombstone would never propagate and peers keep seeing the intent.
    expect(intentExpired(parsed)).toBe(false);
    const exp = Number(w.tags.find((t) => t[0] === 'expiration')?.[1]);
    expect(exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
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

    // One-step Accept: a single accept confirms the deal for both sides.
    const acc1 = makeAccept(b, 'tg:@bob');
    b = applyOutbound(b, acc1);
    expect(b.state).toBe('confirmed');
    expect(b.ourContact).toBe('tg:@bob');
    a = applyInbound(a, acc1, pkB)!;
    expect(a.state).toBe('confirmed');
    expect(a.theirContact).toBe('tg:@bob');

    // Automatic contact back-flow: the proposer replies with their own contact
    // while already confirmed — captured by the peer, state stays confirmed.
    const acc2 = makeAccept(a, 'tg:@alice');
    a = applyOutbound(a, acc2);
    expect(a.state).toBe('confirmed');
    expect(a.ourContact).toBe('tg:@alice');
    b = applyInbound(b, acc2, pkA)!;
    expect(b.state).toBe('confirmed');
    expect(b.theirContact).toBe('tg:@alice');
  });

  it('inbound chat is idempotent: a redelivered DM (same event id) is not appended twice', () => {
    const intent = rideRequest();
    let owner = openNegotiation(intent, pkA, false, pkB);
    const chat = makeChat(owner, 'on my way');

    // First delivery appends the message.
    owner = applyInbound(owner, chat, pkB, 'evt-1')!;
    expect(owner.messages).toHaveLength(1);
    expect(owner.messages![0]).toMatchObject({ dir: 'in', text: 'on my way', id: 'evt-1' });

    // Same DM redelivered by another relay / replayed by the reload backfill —
    // identical event id → ignored (returns null, no second copy).
    expect(applyInbound(owner, chat, pkB, 'evt-1')).toBeNull();

    // A genuinely new message with the same text but a different event id IS kept.
    owner = applyInbound(owner, makeChat(owner, 'on my way'), pkB, 'evt-2')!;
    expect(owner.messages).toHaveLength(2);
  });

  it('dedupeMessages heals stores duplicated before the fix (by id, and legacy by dir/ts/text)', () => {
    // New-format duplicates collapse by id.
    const byId = dedupeMessages([
      { dir: 'in', text: 'hi', ts: 100, id: 'e1' },
      { dir: 'in', text: 'hi', ts: 100, id: 'e1' },
      { dir: 'in', text: 'hi', ts: 100, id: 'e1' },
    ]);
    expect(byId).toHaveLength(1);

    // Legacy id-less duplicates (same dir/ts/text = same replayed event) collapse;
    // a distinct message (different ts) is preserved.
    const legacy = dedupeMessages([
      { dir: 'in', text: 'hi', ts: 100 },
      { dir: 'in', text: 'hi', ts: 100 },
      { dir: 'out', text: 'hi', ts: 101 },
    ]);
    expect(legacy).toHaveLength(2);
  });

  it('a hard cancel from the owner terminates a losing bid that optimistically self-confirmed', () => {
    const intent = rideRequest();
    // Driver B one-tap-accepts at the asking price → optimistically `confirmed`.
    let driver = openNegotiation(intent, pkB, true);
    driver = applyOutbound(driver, makeCounter(driver, { payment: '125,000₫' })); // offer form seeds terms
    driver = applyOutbound(driver, makeAccept(driver, 'tg:@driverB'));
    expect(driver.state).toBe('confirmed');
    // The intent owner already filled with another driver and hard-cancels this
    // bid. The inbound cancel must still apply, even though driver is `confirmed`.
    const owner = openNegotiation(intent, pkA, false, pkB);
    const cancel = makeCancel(owner, 'Filled — taken by another offer');
    const after = applyInbound(driver, cancel, pkA);
    expect(after).not.toBeNull();
    expect(after!.state).toBe('cancelled');
  });

  it('a hard cancel never undoes a completed trip', () => {
    const intent = rideRequest();
    let nego = openNegotiation(intent, pkB, true);
    nego = applyOutbound(nego, makeCounter(nego, { payment: '125,000₫' }));
    nego = applyOutbound(nego, makeAccept(nego, 'tg:@x'));
    nego = { ...nego, stage: 'completed' };
    const cancel = makeCancel(openNegotiation(intent, pkA, false, pkB), 'late cancel');
    expect(applyInbound(nego, cancel, pkA)).toBeNull();
  });

  it('haggle preserves negotiated price when a later counter only changes the time', () => {
    // Regression: counters are partial edits (the UI omits unchanged fields).
    // A counter that only shifts the time must NOT wipe a price haggled earlier,
    // otherwise the confirmed deal card falls back to the original posted terms.
    const intent = rideRequest();
    const now = Math.floor(Date.now() / 1000);
    let b = openNegotiation(intent, pkB, true);
    let a = openNegotiation(intent, pkA, false, pkB);

    // Round 1: B counters the PRICE only.
    const c1 = makeCounter(b, { payment: 'SGD 20' });
    b = applyOutbound(b, c1);
    a = applyInbound(a, c1, pkB)!;
    expect(a.terms?.payment).toBe('SGD 20');

    // Round 2: A counters the TIME only (no payment field on the message).
    const c2 = makeCounter(a, { window: { start: now + 4000, end: now + 5800 } });
    a = applyOutbound(a, c2);
    expect(a.terms?.payment).toBe('SGD 20');          // price carried forward locally
    expect(a.terms?.window?.start).toBe(now + 4000);
    b = applyInbound(b, c2, pkA)!;
    expect(b.terms?.payment).toBe('SGD 20');          // and on the peer
    expect(b.terms?.window?.start).toBe(now + 4000);

    // B accepts → both sides confirm with the FULL negotiated terms.
    const acc = makeAccept(b, 'tg:@bob');
    b = applyOutbound(b, acc);
    a = applyInbound(a, acc, pkB)!;
    expect(a.state).toBe('confirmed');
    expect(b.state).toBe('confirmed');
    expect(a.terms?.payment).toBe('SGD 20');
    expect(b.terms?.payment).toBe('SGD 20');
    expect(a.terms?.window?.start).toBe(now + 4000);
    expect(b.terms?.window?.start).toBe(now + 4000);
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

  it('ignores a stale/backfilled cancel-request after decline or completion', () => {
    // Regression: passenger declined a cancel-request (deal kept) and the trip
    // later completed; on reopen the relay replays the OLD request out of order.
    // It must NOT resurrect the cancel prompt.
    const intent = rideRequest();
    let b = openNegotiation(intent, pkB, true);          // driver initiates
    let a = openNegotiation(intent, pkA, false, pkB);    // passenger (intent owner)
    const c1 = makeCounter(b, { payment: 'SGD 20' });    // seat terms
    b = applyOutbound(b, c1);
    a = applyInbound(a, c1, pkB)!;
    const acc = makeAccept(b, 'tg:@bob');
    b = applyOutbound(b, acc);
    a = applyInbound(a, acc, pkB)!;
    expect(a.state).toBe('confirmed');

    // Driver requests cancel; passenger declines → back to confirmed.
    const req = makeCancelRequest(b);
    b = applyOutbound(b, req);
    a = applyInbound(a, req, pkB)!;
    expect(a.state).toBe('cancel_requested');
    a = applyOutbound(a, makeCancelDecline(a));
    expect(a.state).toBe('confirmed');

    // Replaying that SAME request must be ignored (already in the log).
    expect(applyInbound(a, req, pkB)).toBeNull();
    expect(a.state).toBe('confirmed');

    // Trip completes; a replayed request must still be ignored.
    const done = makeStatus(b, 'completed');
    a = applyInbound(a, done, pkB)!;
    expect(a.stage).toBe('completed');
    expect(applyInbound(a, req, pkB)).toBeNull();
    expect(a.state).toBe('confirmed');
    expect(a.stage).toBe('completed');
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

describe('matchIntent withdrawal tombstones', () => {
  it('never matches an intent whose payload is empty (withdrawn)', () => {
    const now = Math.floor(Date.now() / 1000);
    const intent = {
      id: 'x', pubkey: 'p'.repeat(64), d: 'd1', createdAt: now,
      content: {
        v: 1, side: 'request' as const, market: 'anything', schema: 'custom/1',
        title: '', payload: {}, expires_at: now + 300,
      },
    };
    const rule = { schema: 'custom/1', side: 'offer' as const, market: 'anything' };
    const res = matchIntent(intent as any, rule as any);
    expect(res.matched).toBe(false);
    expect(res.reason).toMatch(/withdrawn/);
  });
});
