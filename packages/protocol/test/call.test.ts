import { describe, it, expect } from 'vitest';
import {
  makeCallOffer,
  makeCallAnswer,
  makeCallHangup,
  mintCallId,
  parseCallEnvelope,
  callOfferFresh,
  parseChatEnvelope,
  parseNegotiationMessage,
  CALL_OFFER_TTL_SECONDS,
} from '../src/index.js';

describe('call envelopes', () => {
  it('round-trips offer/answer/hangup', () => {
    const id = mintCallId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    for (const env of [makeCallOffer(id, 'v=0 sdp', true), makeCallAnswer(id, 'v=0 sdp'), makeCallHangup(id, 'declined')]) {
      expect(parseCallEnvelope(JSON.stringify(env))).toEqual(env);
    }
  });

  it('rejects junk: missing sdp on offer/answer, missing call id, wrong version', () => {
    expect(parseCallEnvelope(JSON.stringify({ v: 1, type: 'call.offer', call: 'x', ts: 1 }))).toBeNull();
    expect(parseCallEnvelope(JSON.stringify({ v: 1, type: 'call.answer', call: 'x', ts: 1 }))).toBeNull();
    expect(parseCallEnvelope(JSON.stringify({ v: 1, type: 'call.offer', sdp: 's', ts: 1 }))).toBeNull();
    expect(parseCallEnvelope(JSON.stringify({ v: 9, type: 'call.hangup', call: 'x', ts: 1 }))).toBeNull();
    expect(parseCallEnvelope('nope')).toBeNull();
  });

  it('offer freshness TTL — the backfill-replay guard', () => {
    const now = Math.floor(Date.now() / 1000);
    const fresh = makeCallOffer(mintCallId(), 'sdp', false);
    expect(callOfferFresh(fresh, now)).toBe(true);
    expect(callOfferFresh({ ...fresh, ts: now - CALL_OFFER_TTL_SECONDS - 1 }, now)).toBe(false);
    // Only offers ring; other types are never "fresh".
    expect(callOfferFresh(makeCallHangup('x', 'ended'), now)).toBe(false);
  });

  it('never cross-parses with the chat or negotiation families', () => {
    const call = JSON.stringify(makeCallOffer(mintCallId(), 'sdp', false));
    expect(parseChatEnvelope(call)).toBeNull();
    expect(parseNegotiationMessage(call)).toBeNull();
  });
});
