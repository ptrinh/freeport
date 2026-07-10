/**
 * Regression: a deal card for an offer I sent (state 'open', terms by us —
 * e.g. responding to a post with a changed price) rendered NOTHING below the
 * title: no status, no chat, no cancel. Next to accepted deals with their
 * "waiting for the other party" banner it read as broken (user report).
 * isPendingOffer decides when the new "Offer sent" banner shows; offerSummary
 * builds its "150.000₫ · 12:45" line.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
import { isPendingOffer, offerSummary } from '../src/deals';

const fmtTime = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

describe('isPendingOffer — when the "Offer sent" banner shows', () => {
  it('the reported case: my offer is out, poster silent → banner', () => {
    expect(isPendingOffer({ state: 'open', termsBy: 'us' } as any)).toBe(true);
  });

  it('their proposal awaiting MY action → no banner (action buttons instead)', () => {
    expect(isPendingOffer({ state: 'open', termsBy: 'them' } as any)).toBe(false);
  });

  it('accepted/confirmed/cancelled states → no banner (they have their own UI)', () => {
    for (const state of ['accepted_by_them', 'confirmed', 'cancelled', 'expired', 'cancel_requested']) {
      expect(isPendingOffer({ state, termsBy: 'us' } as any)).toBe(false);
    }
  });
});

describe('offerSummary — the "You offered …" line', () => {
  it('price + fixed time → "price · time"', () => {
    const terms = { payment: '150.000₫', window: { start: Date.UTC(2026, 6, 10, 5, 45) / 1000 } };
    expect(offerSummary(terms, fmtTime)).toBe('150.000₫ · 05:45');
  });

  it('price only (flexible time) → just the price', () => {
    expect(offerSummary({ payment: 'S$65' }, fmtTime)).toBe('S$65');
  });

  it('time only (no price offered) → just the time', () => {
    expect(offerSummary({ window: { start: Date.UTC(2026, 6, 10, 5, 45) / 1000 } }, fmtTime)).toBe('05:45');
  });

  it('nothing concrete → empty (banner falls back to the generic line)', () => {
    expect(offerSummary({}, fmtTime)).toBe('');
    expect(offerSummary(undefined, fmtTime)).toBe('');
  });
});
