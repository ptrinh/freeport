import { describe, it, expect } from 'vitest';
import { makeAccept, applyInbound, openNegotiation } from '@freeport/protocol';
import type { Intent, Negotiation } from '@freeport/protocol';

const intent = {
  id: 'evt1',
  pubkey: 'poster'.padEnd(64, '0'),
  content: { schema: 'rideshare.request.v1', payload: {}, market: 'x' },
  createdAt: 1,
  expiresAt: 9999999999,
} as unknown as Intent;

const ME = 'me'.padEnd(64, '1');
// weInitiated=true → the peer is the intent's author.
const PEER = intent.pubkey;

function confirmedNego(): Negotiation {
  const base = openNegotiation(intent, ME, true, PEER);
  return { ...base, state: 'confirmed', theirContact: 'Peer · +6511111111', terms: { payment: '25 SGD' } };
}

describe('payAddress on accept', () => {
  it('makeAccept includes payAddress only when provided', () => {
    const nego = confirmedNego();
    expect((makeAccept(nego, 'Me · +65222') as any).payAddress).toBeUndefined();
    expect((makeAccept(nego, 'Me · +65222', 'sprt1qxyz') as any).payAddress).toBe('sprt1qxyz');
  });

  it('captures theirPayAddress from an inbound accept', () => {
    const nego = confirmedNego();
    const msg = { ...makeAccept(nego, 'Peer · +6511111111', 'peer@wallet.example'), nego: nego.id };
    const updated = applyInbound(nego, msg as any, PEER);
    expect(updated?.theirPayAddress).toBe('peer@wallet.example');
    expect(updated?.state).toBe('confirmed');
  });

  it('a duplicate accept with a NEW address updates it (not deduped away)', () => {
    const nego = { ...confirmedNego(), theirPayAddress: undefined };
    const msg = { ...makeAccept(nego, 'Peer · +6511111111', 'sprt1qlate'), nego: nego.id };
    const updated = applyInbound(nego, msg as any, PEER);
    expect(updated?.theirPayAddress).toBe('sprt1qlate');
  });

  it('a re-sent accept WITHOUT an address never clears a known one', () => {
    const nego = { ...confirmedNego(), theirPayAddress: 'sprt1qkeep' };
    const withNew = { ...makeAccept(nego, 'Peer · +6511111111 changed'), nego: nego.id };
    const updated = applyInbound(nego, withNew as any, PEER);
    expect(updated?.theirPayAddress).toBe('sprt1qkeep');
  });

  it('an identical duplicate (same contact, same address) stays a no-op', () => {
    const nego = { ...confirmedNego(), theirPayAddress: 'sprt1qsame' };
    const dup = { ...makeAccept(nego, 'Peer · +6511111111', 'sprt1qsame'), nego: nego.id };
    expect(applyInbound(nego, dup as any, PEER)).toBeNull();
  });
});
