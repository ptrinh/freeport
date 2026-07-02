/**
 * Price suggestion — especially the SERVICE per-hour path: comparables with
 * different durations normalize to price/hour and the suggestion scales back
 * to the requested duration. No prior test covered suggestPrice at all.
 */
import { describe, it, expect } from 'vitest';
import { suggestPrice } from '../src/pricing';
import { RIDESHARE_CATEGORY } from '../src/categories';
import type { Intent } from '@freeport/protocol';
import type { Reputation } from '../src/reputation';

const now = () => Math.floor(Date.now() / 1000);
let n = 0;

function serviceIntent(payment: string, durationMin: number | undefined, over: Record<string, unknown> = {}): Intent {
  n++;
  return {
    id: `ev${n}`, pubkey: `pk${n}`.padEnd(64, '0'), d: `d${n}`, createdAt: now(),
    content: {
      v: 1, side: 'offer', market: 'sg-service', schema: 'service/1',
      title: 'Cleaning', payload: { service: 'Cleaning', category: 'Home Services', subcategory: 'Cleaning', payment, duration_minutes: durationMin, ...over },
      expires_at: now() + 3600,
    },
  } as unknown as Intent;
}

function rideIntent(payment: string): Intent {
  n++;
  return {
    id: `ev${n}`, pubkey: `pk${n}`.padEnd(64, '0'), d: `d${n}`, createdAt: now(),
    content: {
      v: 1, side: 'offer', market: 'sg-rideshare', schema: 'rideshare/1',
      title: 'Ride', payload: { from: { name: 'A' }, to: { name: 'B' }, category: 'Compact Car', payment },
      expires_at: now() + 3600,
    },
  } as unknown as Intent;
}

const NO_REPS = new Map<string, Reputation>();
const svcInput = (durationMin?: number) => ({
  schemaPrefix: 'service' as const, category: 'Home Services', subcategory: 'Cleaning',
  currency: 'USD' as const, durationMin,
});

describe('suggestPrice — service per-hour normalization', () => {
  it('normalizes mixed durations to price/hour and scales to the requested duration', () => {
    // $30/1h, $60/2h, $90/3h — all exactly $30/hour.
    const intents = [
      serviceIntent('USD 30', 60),
      serviceIntent('USD 60', 120),
      serviceIntent('USD 90', 180),
    ];
    const s = suggestPrice(svcInput(90), intents, NO_REPS)!; // asking for 1.5h
    expect(s.basis).toBe('per_hour');
    expect(s.median).toBe(45); // $30/h × 1.5h
    expect(s.n).toBe(3);
    expect(s.scope).toBe('exact');
  });

  it('skips comparables without a duration when normalizing per-hour', () => {
    const intents = [
      serviceIntent('USD 30', 60),
      serviceIntent('USD 60', 120),
      serviceIntent('USD 999', undefined), // no duration → unusable for /hour
      serviceIntent('USD 30', 60),
    ];
    const s = suggestPrice(svcInput(60), intents, NO_REPS)!;
    expect(s.median).toBe(30);
    expect(s.n).toBe(3);
  });

  it('returns null below the minimum sample size', () => {
    expect(suggestPrice(svcInput(60), [serviceIntent('USD 30', 60), serviceIntent('USD 40', 60)], NO_REPS)).toBeNull();
  });

  it('widens subcategory → category when the exact subcategory is thin', () => {
    const intents = [
      serviceIntent('USD 30', 60, { subcategory: 'Cleaning' }),
      serviceIntent('USD 30', 60, { subcategory: 'Plumbing' }),
      serviceIntent('USD 30', 60, { subcategory: 'Plumbing' }),
    ];
    const s = suggestPrice(svcInput(60), intents, NO_REPS)!;
    expect(s.scope).toBe('widened');
    expect(s.median).toBe(30);
  });

  it('excludes other dollar currencies from a USD suggestion', () => {
    // Regression companion to the paymentInCurrency fix: S$ asks must not
    // enter a USD median.
    const intents = [
      serviceIntent('USD 30', 60),
      serviceIntent('USD 30', 60),
      serviceIntent('USD 30', 60),
      serviceIntent('S$500', 60),
      serviceIntent('S$500', 60),
    ];
    const s = suggestPrice(svcInput(60), intents, NO_REPS)!;
    expect(s.median).toBe(30);
    expect(s.n).toBe(3);
  });
});

describe('suggestPrice — absolute basis (rideshare)', () => {
  it('uses the raw asking prices with no duration scaling', () => {
    const intents = [rideIntent('USD 10'), rideIntent('USD 12'), rideIntent('USD 14')];
    const s = suggestPrice(
      // Rideshare's category is the fixed vertical; the vehicle is the SUBcategory.
      { schemaPrefix: 'rideshare', category: RIDESHARE_CATEGORY, currency: 'USD' },
      intents, NO_REPS,
    )!;
    expect(s.basis).toBe('absolute');
    expect(s.median).toBe(12);
  });
});
