import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
  buildIntentEvent,
  parseIntentEvent,
  openNegotiation,
  makeCounter,
  makeAccept,
  makeChat,
  makeStatus,
  makeCancel,
  makeCancelRequest,
  makeCancelAgree,
  makeCancelDecline,
  applyOutbound,
  applyInbound,
  isTerminal,
  expireNegotiation,
  dedupeNegotiationMessages,
  DEMO_MARKET,
  DEMO_SCHEMA,
  type Intent,
} from '../src/index.js';

const skA = generateSecretKey();
const pkA = getPublicKey(skA);
const skB = generateSecretKey();
const pkB = getPublicKey(skB);

function ride(): Intent {
  const now = Math.floor(Date.now() / 1000);
  const ev = buildIntentEvent(
    {
      side: 'request',
      market: DEMO_MARKET,
      schema: DEMO_SCHEMA,
      title: 'Ride',
      payload: { seats: 1 },
      window: { start: now + 3600, end: now + 5400 },
      expiresAt: now + 86400,
    },
    skA,
  );
  return parseIntentEvent(ev)!;
}

/** Drive a fresh nego (owner side) up to `confirmed`. Returns owner + the shared intent. */
function confirmedWith() {
  const intent = ride();
  const driver = openNegotiation(intent, pkB, true);
  const owner = openNegotiation(intent, pkA, false, pkB);
  const c = makeCounter(driver, { payment: 'SGD 20' });
  const owner2 = applyInbound(owner, c, pkB)!;
  const acc = makeAccept({ ...driver, terms: { payment: 'SGD 20' } }, 'tg:@driver');
  const owner3 = applyInbound(owner2, acc, pkB)!;
  expect(owner3.state).toBe('confirmed');
  return { nego: owner3, intent, driver };
}

function confirmed() {
  return confirmedWith().nego;
}

describe('applyInbound MSG_CHAT branches', () => {
  it('appends a chat in confirmed state', () => {
    const c = confirmed();
    const after = applyInbound(c, makeChat(c, 'meet at gate'), pkB, 'e1')!;
    expect(after.messages).toHaveLength(1);
    expect(after.messages![0]).toMatchObject({ dir: 'in', text: 'meet at gate' });
  });

  it('rejects chat with no text', () => {
    const intent = ride();
    const owner = openNegotiation(intent, pkA, false, pkB);
    const msg = { ...makeChat(owner, 'x'), text: undefined };
    expect(applyInbound(owner, msg as any, pkB, 'e1')).toBeNull();
  });

  it('rejects chat in cancelled state', () => {
    const intent = ride();
    let owner = openNegotiation(intent, pkA, false, pkB);
    owner = applyOutbound(owner, makeCancel(owner));
    expect(owner.state).toBe('cancelled');
    expect(applyInbound(owner, makeChat(owner, 'hi'), pkB, 'e1')).toBeNull();
  });

  it('rejects chat in expired state', () => {
    const intent = ride();
    let owner = openNegotiation(intent, pkA, false, pkB);
    owner = expireNegotiation(owner);
    expect(owner.state).toBe('expired');
    expect(applyInbound(owner, makeChat(owner, 'hi'), pkB, 'e1')).toBeNull();
  });

  it('dedups a replayed chat by event id', () => {
    const intent = ride();
    let owner = openNegotiation(intent, pkA, false, pkB);
    owner = applyInbound(owner, makeChat(owner, 'hi'), pkB, 'dup')!;
    expect(applyInbound(owner, makeChat(owner, 'hi'), pkB, 'dup')).toBeNull();
  });
});

describe('applyInbound MSG_STATUS branches', () => {
  it('advances stage undefined -> picked_up -> completed', () => {
    let c = confirmed();
    c = applyInbound(c, makeStatus(c, 'picked_up'), pkB)!;
    expect(c.stage).toBe('picked_up');
    c = applyInbound(c, makeStatus(c, 'completed'), pkB)!;
    expect(c.stage).toBe('completed');
  });

  it('ignores a stale lower stage delivered after a higher one', () => {
    let c = confirmed();
    c = applyInbound(c, makeStatus(c, 'completed'), pkB)!;
    expect(c.stage).toBe('completed');
    // backfilled picked_up replays out of order — must not revert
    expect(applyInbound(c, makeStatus(c, 'picked_up'), pkB)).toBeNull();
    expect(c.stage).toBe('completed');
  });

  it('ignores a duplicate same-stage status (no advance)', () => {
    let c = confirmed();
    c = applyInbound(c, makeStatus(c, 'picked_up'), pkB)!;
    expect(applyInbound(c, makeStatus(c, 'picked_up'), pkB)).toBeNull();
  });

  it('rejects status when not confirmed/cancel_requested', () => {
    const intent = ride();
    const owner = openNegotiation(intent, pkA, false, pkB);
    expect(owner.state).toBe('open');
    expect(applyInbound(owner, makeStatus(owner, 'picked_up'), pkB)).toBeNull();
  });

  it('allows status while cancel_requested', () => {
    let c = confirmed();
    c = applyInbound(c, makeCancelRequest(c), pkB)!;
    expect(c.state).toBe('cancel_requested');
    c = applyInbound(c, makeStatus(c, 'picked_up'), pkB)!;
    expect(c.stage).toBe('picked_up');
  });

  it('rejects an invalid stage value', () => {
    const c = confirmed();
    const msg = { ...makeStatus(c, 'picked_up'), stage: 'bogus' };
    expect(applyInbound(c, msg as any, pkB)).toBeNull();
  });
});

describe('applyInbound MSG_ACCEPT branches', () => {
  it('confirms, captures their contact and merges terms', () => {
    const intent = ride();
    const owner = openNegotiation(intent, pkA, false, pkB);
    const seeded = { ...owner, terms: { payment: 'SGD 20' } };
    const driver = openNegotiation(intent, pkB, true);
    const acc = makeAccept({ ...driver, terms: { payment: 'SGD 20', note: 'extra' } }, 'tg:@driver');
    const after = applyInbound(seeded, acc, pkB)!;
    expect(after.state).toBe('confirmed');
    expect(after.theirContact).toBe('tg:@driver');
    expect(after.terms?.note).toBe('extra');
    expect(after.terms?.payment).toBe('SGD 20');
  });

  it('rejects an accept with no contact', () => {
    const intent = ride();
    const owner = { ...openNegotiation(intent, pkA, false, pkB), terms: { payment: 'x' } };
    const driver = openNegotiation(intent, pkB, true);
    const acc = { ...makeAccept({ ...driver, terms: { payment: 'x' } }, 'tg:@d'), contact: undefined };
    expect(applyInbound(owner, acc as any, pkB)).toBeNull();
  });

  it('dedups a duplicate accept with the same contact while already confirmed', () => {
    const { nego: c, driver } = confirmedWith();
    const acc = makeAccept({ ...driver, terms: { payment: 'SGD 20' } }, 'tg:@driver');
    // c already has theirContact = tg:@driver
    expect(c.theirContact).toBe('tg:@driver');
    expect(applyInbound(c, acc, pkB)).toBeNull();
  });

  it('accepts a different contact while confirmed (back-flow updates contact)', () => {
    const { nego: c, driver } = confirmedWith();
    const acc = makeAccept({ ...driver, terms: { payment: 'SGD 20' } }, 'tg:@new');
    const after = applyInbound(c, acc, pkB)!;
    expect(after.theirContact).toBe('tg:@new');
  });

  it('rejects accept in cancelled state', () => {
    const intent = ride();
    let owner = openNegotiation(intent, pkA, false, pkB);
    owner = applyOutbound(owner, makeCancel(owner));
    const driver = openNegotiation(intent, pkB, true);
    const acc = makeAccept({ ...driver, terms: { payment: 'x' } }, 'tg:@d');
    expect(applyInbound(owner, acc, pkB)).toBeNull();
  });
});

describe('applyInbound MSG_COUNTER branches', () => {
  it('sets merged terms, termsBy=them, increments rounds, sets theirContact', () => {
    const intent = ride();
    const owner = { ...openNegotiation(intent, pkA, false, pkB), terms: { payment: 'SGD 10' } };
    const driver = openNegotiation(intent, pkB, true);
    const c = makeCounter(driver, { note: 'evening ok' }, 'tg:@driver');
    const after = applyInbound(owner, c, pkB)!;
    expect(after.state).toBe('open');
    expect(after.termsBy).toBe('them');
    expect(after.rounds).toBe(1);
    expect(after.theirContact).toBe('tg:@driver');
    expect(after.terms?.payment).toBe('SGD 10'); // preserved
    expect(after.terms?.note).toBe('evening ok'); // merged
  });

  it('rejects a counter with no terms', () => {
    const intent = ride();
    const owner = openNegotiation(intent, pkA, false, pkB);
    const driver = openNegotiation(intent, pkB, true);
    const msg = { ...makeCounter(driver, { note: 'x' }), terms: undefined };
    expect(applyInbound(owner, msg as any, pkB)).toBeNull();
  });

  it('rejects a counter past MAX_ROUNDS', () => {
    const intent = ride();
    let owner = openNegotiation(intent, pkA, false, pkB);
    const driver = openNegotiation(intent, pkB, true);
    for (let i = 0; i < 8; i++) {
      owner = applyInbound(owner, makeCounter(driver, { note: `r${i}` }), pkB)!;
    }
    expect(owner.rounds).toBe(8);
    expect(applyInbound(owner, makeCounter(driver, { note: 'over' }), pkB)).toBeNull();
  });
});

describe('applyInbound cancel flows', () => {
  it('cancel_request only from confirmed; rejected when open', () => {
    const intent = ride();
    const owner = openNegotiation(intent, pkA, false, pkB);
    expect(applyInbound(owner, makeCancelRequest(owner), pkB)).toBeNull();
  });

  it('cancel_request -> cancel_requested(by them) from confirmed', () => {
    const c = confirmed();
    const after = applyInbound(c, makeCancelRequest(c), pkB)!;
    expect(after.state).toBe('cancel_requested');
    expect(after.cancelRequestedBy).toBe('them');
  });

  it('cancel_request rejected when stage completed', () => {
    let c = confirmed();
    c = applyInbound(c, makeStatus(c, 'completed'), pkB)!;
    expect(applyInbound(c, makeCancelRequest(c), pkB)).toBeNull();
  });

  it('cancel_agree -> cancelled', () => {
    let c = confirmed();
    c = applyInbound(c, makeCancelRequest(c), pkB)!;
    const after = applyInbound(c, makeCancelAgree(c), pkB)!;
    expect(after.state).toBe('cancelled');
    expect(after.cancelRequestedBy).toBeUndefined();
  });

  it('cancel_decline -> back to confirmed', () => {
    let c = confirmed();
    c = applyInbound(c, makeCancelRequest(c), pkB)!;
    const after = applyInbound(c, makeCancelDecline(c), pkB)!;
    expect(after.state).toBe('confirmed');
    expect(after.cancelRequestedBy).toBeUndefined();
  });

  it('cancel_agree/decline rejected when not cancel_requested', () => {
    const c = confirmed();
    expect(applyInbound(c, makeCancelAgree(c), pkB)).toBeNull();
    expect(applyInbound(c, makeCancelDecline(c), pkB)).toBeNull();
  });

  it('unilateral cancel terminates a confirmed deal', () => {
    const c = confirmed();
    const after = applyInbound(c, makeCancel(c), pkB)!;
    expect(after.state).toBe('cancelled');
  });

  it('a replayed unilateral cancel (same type+ts in log) is a no-op', () => {
    const c = confirmed();
    const cancel = makeCancel(c);
    const after = applyInbound(c, cancel, pkB)!;
    expect(after.state).toBe('cancelled');
    // already terminal so guard returns null
    expect(applyInbound(after, cancel, pkB)).toBeNull();
  });

  it('a replayed cancel detected via log (non-terminal path) is a no-op', () => {
    // craft a nego that holds a CANCEL in its log but is not terminal,
    // so we exercise the log-dedup branch specifically.
    const c = confirmed();
    const cancel = makeCancel(c);
    const withLog = { ...c, log: [...c.log, { dir: 'in' as const, msg: cancel }] };
    expect(applyInbound(withLog, cancel, pkB)).toBeNull();
  });
});

describe('applyInbound guard branches', () => {
  it('rejects msg whose nego id does not match', () => {
    const intent = ride();
    const owner = openNegotiation(intent, pkA, false, pkB);
    const bad = { ...makeChat(owner, 'hi'), nego: 'other-id' };
    expect(applyInbound(owner, bad, pkB, 'e1')).toBeNull();
  });

  it('rejects a peer-mismatched message when peer is set', () => {
    const intent = ride();
    const owner = openNegotiation(intent, pkA, false, pkB); // peer = pkB
    const mallory = getPublicKey(generateSecretKey());
    expect(applyInbound(owner, makeChat(owner, 'hi'), mallory, 'e1')).toBeNull();
  });

  it('rejects an unknown message type in the open state default branch', () => {
    const intent = ride();
    const owner = openNegotiation(intent, pkA, false, pkB);
    const bad = { ...makeChat(owner, 'hi'), type: 'negotiate.unknown' };
    // type isn't CHAT/STATUS/ACCEPT/COUNTER/cancel* so falls to default -> null
    expect(applyInbound(owner, bad as any, pkB)).toBeNull();
  });
});

describe('applyOutbound transitions', () => {
  it('outbound counter sets terms/termsBy=us/rounds/ourContact', () => {
    const intent = ride();
    let driver = openNegotiation(intent, pkB, true);
    driver = applyOutbound(driver, makeCounter(driver, { payment: 'SGD 15' }, 'tg:@me'));
    expect(driver.termsBy).toBe('us');
    expect(driver.rounds).toBe(1);
    expect(driver.ourContact).toBe('tg:@me');
    expect(driver.terms?.payment).toBe('SGD 15');
  });

  it('outbound accept confirms and sets ourContact', () => {
    const intent = ride();
    let driver = openNegotiation(intent, pkB, true);
    driver = applyOutbound(driver, makeCounter(driver, { payment: 'SGD 15' }));
    driver = applyOutbound(driver, makeAccept(driver, 'tg:@me'));
    expect(driver.state).toBe('confirmed');
    expect(driver.ourContact).toBe('tg:@me');
  });

  it('outbound status sets stage; outbound cancel-request/agree/decline transitions', () => {
    const intent = ride();
    let d = openNegotiation(intent, pkB, true);
    d = applyOutbound(d, makeCounter(d, { payment: 'x' }));
    d = applyOutbound(d, makeAccept(d, 'tg:@me'));
    d = applyOutbound(d, makeStatus(d, 'picked_up'));
    expect(d.stage).toBe('picked_up');
    d = applyOutbound(d, makeCancelRequest(d));
    expect(d.state).toBe('cancel_requested');
    expect(d.cancelRequestedBy).toBe('us');
    d = applyOutbound(d, makeCancelDecline(d));
    expect(d.state).toBe('confirmed');
    d = applyOutbound(d, makeCancelRequest(d));
    d = applyOutbound(d, makeCancelAgree(d));
    expect(d.state).toBe('cancelled');
  });

  it('outbound chat appends to messages', () => {
    const intent = ride();
    let d = openNegotiation(intent, pkB, true);
    d = applyOutbound(d, makeChat(d, 'hello'));
    expect(d.messages).toHaveLength(1);
    expect(d.messages![0]).toMatchObject({ dir: 'out', text: 'hello' });
  });
});

describe('make* guards', () => {
  it('makeCounter throws in a confirmed (bad) state', () => {
    const c = confirmed();
    expect(() => makeCounter(c, { note: 'x' })).toThrow(/cannot counter/);
  });

  it('makeCounter throws past MAX_ROUNDS', () => {
    const intent = ride();
    let d = openNegotiation(intent, pkB, true);
    for (let i = 0; i < 8; i++) d = applyOutbound(d, makeCounter(d, { note: `r${i}` }));
    expect(() => makeCounter(d, { note: 'over' })).toThrow(/max negotiation rounds/);
  });

  it('makeCounter allowed in accepted_by_them state', () => {
    const intent = ride();
    const d = { ...openNegotiation(intent, pkB, true), state: 'accepted_by_them' as const };
    expect(() => makeCounter(d, { note: 'ok' })).not.toThrow();
  });

  it('makeAccept throws when no terms on the table', () => {
    const intent = ride();
    const d = openNegotiation(intent, pkB, true);
    expect(() => makeAccept(d, 'tg:@me')).toThrow(/no terms/);
  });

  it('makeAccept throws in cancelled state', () => {
    const intent = ride();
    let d = openNegotiation(intent, pkB, true);
    d = applyOutbound(d, makeCancel(d));
    expect(() => makeAccept(d, 'tg:@me')).toThrow(/cannot accept/);
  });

  it('makeAccept throws in expired state', () => {
    const intent = ride();
    let d = openNegotiation(intent, pkB, true);
    d = { ...expireNegotiation(d), terms: { payment: 'x' } };
    expect(() => makeAccept(d, 'tg:@me')).toThrow(/cannot accept/);
  });
});

describe('isTerminal / expireNegotiation / dedupeNegotiationMessages', () => {
  it('isTerminal true for confirmed/cancelled/expired, false for open', () => {
    const intent = ride();
    const open = openNegotiation(intent, pkB, true);
    expect(isTerminal(open)).toBe(false);
    expect(isTerminal({ ...open, state: 'confirmed' })).toBe(true);
    expect(isTerminal({ ...open, state: 'cancelled' })).toBe(true);
    expect(isTerminal({ ...open, state: 'expired' })).toBe(true);
  });

  it('expireNegotiation leaves confirmed/cancelled untouched but expires open', () => {
    const intent = ride();
    const open = openNegotiation(intent, pkB, true);
    expect(expireNegotiation(open).state).toBe('expired');
    expect(expireNegotiation({ ...open, state: 'confirmed' }).state).toBe('confirmed');
    expect(expireNegotiation({ ...open, state: 'cancelled' }).state).toBe('cancelled');
  });

  it('dedupeNegotiationMessages returns same ref when nothing to dedup, deduped copy otherwise', () => {
    const intent = ride();
    const base = openNegotiation(intent, pkB, true);
    const clean = { ...base, messages: [{ dir: 'in' as const, text: 'a', ts: 1, id: 'x' }] };
    expect(dedupeNegotiationMessages(clean)).toBe(clean);
    const dup = { ...base, messages: [
      { dir: 'in' as const, text: 'a', ts: 1, id: 'x' },
      { dir: 'in' as const, text: 'a', ts: 1, id: 'x' },
    ] };
    expect(dedupeNegotiationMessages(dup).messages).toHaveLength(1);
  });
});

describe('applyInbound event-id replay guard (all message types)', () => {
  it('a replayed COUNTER (same event id) does not inflate rounds or overwrite terms', () => {
    const intent = ride();
    const driver = openNegotiation(intent, pkB, true);
    let owner = openNegotiation(intent, pkA, false, pkB);
    const c1 = makeCounter(driver, { payment: 'SGD 20' });
    owner = applyInbound(owner, c1, pkB, 'ev-c1')!;
    expect(owner.rounds).toBe(1);
    expect(owner.seenEventIds).toContain('ev-c1');
    // Newer counter supersedes it…
    const c2 = makeCounter({ ...driver, rounds: 1 }, { payment: 'SGD 25' });
    owner = applyInbound(owner, c2, pkB, 'ev-c2')!;
    expect(owner.terms?.payment).toBe('SGD 25');
    expect(owner.rounds).toBe(2);
    // …then the backfill replays the OLD counter: must be a no-op.
    expect(applyInbound(owner, c1, pkB, 'ev-c1')).toBeNull();
    expect(owner.terms?.payment).toBe('SGD 25');
  });

  it('replayed counters cannot brick the negotiation at MAX_ROUNDS', () => {
    const intent = ride();
    const driver = openNegotiation(intent, pkB, true);
    let owner = openNegotiation(intent, pkA, false, pkB);
    const c = makeCounter(driver, { payment: 'SGD 20' });
    owner = applyInbound(owner, c, pkB, 'ev-x')!;
    for (let i = 0; i < 20; i++) expect(applyInbound(owner, c, pkB, 'ev-x')).toBeNull();
    expect(owner.rounds).toBe(1);
  });

  it('a replayed ACCEPT does not dismiss a pending cancel-request', () => {
    const intent = ride();
    const driver = openNegotiation(intent, pkB, true);
    let owner = openNegotiation(intent, pkA, false, pkB);
    const c = makeCounter(driver, { payment: 'SGD 20' });
    owner = applyInbound(owner, c, pkB, 'ev-c')!;
    const acc = makeAccept({ ...driver, terms: { payment: 'SGD 20' } }, 'tg:@driver');
    owner = applyInbound(owner, acc, pkB, 'ev-acc')!;
    expect(owner.state).toBe('confirmed');
    const req = makeCancelRequest({ ...driver, state: 'confirmed' });
    owner = applyInbound(owner, req, pkB, 'ev-req')!;
    expect(owner.state).toBe('cancel_requested');
    // Backfill replays the original accept — must not flip back to confirmed.
    expect(applyInbound(owner, acc, pkB, 'ev-acc')).toBeNull();
  });

  it('a NEW accept (fresh event id) during cancel_requested records contact but keeps state', () => {
    const intent = ride();
    const driver = openNegotiation(intent, pkB, true);
    let owner = openNegotiation(intent, pkA, false, pkB);
    const c = makeCounter(driver, { payment: 'SGD 20' });
    owner = applyInbound(owner, c, pkB, 'ev-c')!;
    const acc = makeAccept({ ...driver, terms: { payment: 'SGD 20' } }, 'tg:@driver');
    owner = applyInbound(owner, acc, pkB, 'ev-acc')!;
    const req = makeCancelRequest({ ...driver, state: 'confirmed' });
    owner = applyInbound(owner, req, pkB, 'ev-req')!;
    const acc2 = makeAccept({ ...driver, terms: { payment: 'SGD 20' } }, 'tg:@driver2');
    const after = applyInbound(owner, acc2, pkB, 'ev-acc2')!;
    expect(after.state).toBe('cancel_requested');
    expect(after.theirContact).toBe('tg:@driver2');
  });

  it('messages without an event id still apply (agent/legacy path)', () => {
    const intent = ride();
    const driver = openNegotiation(intent, pkB, true);
    const owner = openNegotiation(intent, pkA, false, pkB);
    const c = makeCounter(driver, { payment: 'SGD 20' });
    const after = applyInbound(owner, c, pkB)!;
    expect(after.rounds).toBe(1);
    expect(after.seenEventIds).toBeUndefined();
  });

  it('seenEventIds is bounded at 500', () => {
    const intent = ride();
    const driver = openNegotiation(intent, pkB, true);
    let owner = openNegotiation(intent, pkA, false, pkB);
    const c = makeCounter(driver, { payment: 'SGD 20' });
    owner = applyInbound(owner, c, pkB, 'ev-c')!;
    const acc = makeAccept({ ...driver, terms: { payment: 'SGD 20' } }, 'tg:@driver');
    owner = applyInbound(owner, acc, pkB, 'ev-acc')!;
    for (let i = 0; i < 600; i++) {
      const chat = makeChat({ ...driver, state: 'confirmed' }, `m${i}`);
      owner = applyInbound(owner, chat, pkB, `ev-chat-${i}`)!;
    }
    expect(owner.seenEventIds!.length).toBeLessThanOrEqual(500);
    expect(owner.seenEventIds).toContain('ev-chat-599');
  });
});

describe('expireNegotiation cancel_requested guard', () => {
  it('does not expire a confirmed deal with a pending cancel-request', () => {
    const intent = ride();
    const driver = openNegotiation(intent, pkB, true);
    let owner = openNegotiation(intent, pkA, false, pkB);
    const c = makeCounter(driver, { payment: 'SGD 20' });
    owner = applyInbound(owner, c, pkB, 'ev-c')!;
    const acc = makeAccept({ ...driver, terms: { payment: 'SGD 20' } }, 'tg:@driver');
    owner = applyInbound(owner, acc, pkB, 'ev-acc')!;
    const req = makeCancelRequest({ ...driver, state: 'confirmed' });
    owner = applyInbound(owner, req, pkB, 'ev-req')!;
    expect(expireNegotiation(owner).state).toBe('cancel_requested');
  });
});

describe('cancel-request replay dedupe is direction-aware', () => {
  it("our own outbound cancel-request does not suppress the peer's same-second request", () => {
    const { nego } = confirmedWith(); // owner side, confirmed with pkB
    // We request a cancel (outbound), peer declines → back to confirmed.
    const ourReq = makeCancelRequest(nego);
    let n = applyOutbound(nego, ourReq);
    n = applyInbound(n, makeCancelDecline({ ...n, peer: pkB }), pkB, 'ev-decline')!;
    expect(n.state).toBe('confirmed');
    // Within the SAME second, the peer sends their own cancel-request. Same
    // (type, ts) as our outbound one — but it is not a replay and must apply.
    const theirReq = { ...makeCancelRequest(n), ts: ourReq.ts };
    const after = applyInbound(n, theirReq, pkB, 'ev-their-req');
    expect(after?.state).toBe('cancel_requested');
    expect(after?.cancelRequestedBy).toBe('them');
  });
});
