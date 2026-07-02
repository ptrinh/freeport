import { describe, it, expect } from 'vitest';
import { matchIntent, geohashEncode, SERVICE_MARKET, SERVICE_SCHEMA, type Intent, type MatchRule } from '../src/index.js';

// Hanoi Old Quarter vs a point ~1,700km away (Singapore) for the proximity gate.
const HANOI = geohashEncode(21.0338, 105.8500, 7);
const HANOI_NEARBY = geohashEncode(21.0355, 105.8512, 7); // same precision-5 cell
const SINGAPORE = geohashEncode(1.3008, 103.8427, 7);

const now = () => Math.floor(Date.now() / 1000);

/** A consumer's service request at `geohash`, optionally with a time window. */
function serviceIntent(geohash: string | undefined, window?: { start: number; end: number }): Intent {
  return {
    id: 'ev1', pubkey: 'p'.repeat(64), d: 'd1', createdAt: now(),
    content: {
      v: 1, side: 'request', market: SERVICE_MARKET, schema: SERVICE_SCHEMA,
      title: 'Need a plumber',
      payload: {
        service: 'Leaky tap repair',
        location: geohash ? { name: 'Old Quarter', geohash } : undefined,
        category: 'Home Services',
      },
      window,
      expires_at: now() + 3600,
    },
  } as unknown as Intent;
}

/** A provider rule anchored in Hanoi, working 09:00–17:00. */
function providerRule(over: Partial<MatchRule> = {}): MatchRule {
  return {
    schema: SERVICE_SCHEMA, side: 'offer', market: SERVICE_MARKET,
    route: { from_geohash: HANOI, to_geohash: HANOI },
    daily_window: { start: '09:00', end: '17:00' },
    flex_minutes: 60,
    price: 'USD 50',
    contact: 'tg:@provider',
    ...over,
  };
}

/** A window on TODAY at local HH:MM (duration in minutes), TZ-safe. */
function todayAt(h: number, m: number, durMin: number) {
  const d = new Date(); d.setHours(h, m, 0, 0);
  const start = Math.floor(d.getTime() / 1000);
  return { start, end: start + durMin * 60 };
}

describe('matchService', () => {
  it('rejects a request with no location', () => {
    const res = matchIntent(serviceIntent(undefined), providerRule());
    expect(res.matched).toBe(false);
    expect(res.reason).toMatch(/missing location/);
  });

  it('rejects a request outside the provider service area', () => {
    const res = matchIntent(serviceIntent(SINGAPORE), providerRule());
    expect(res.matched).toBe(false);
    expect(res.reason).toMatch(/too far/);
  });

  it('accepts as-is when nearby and the request has no time window', () => {
    const res = matchIntent(serviceIntent(HANOI_NEARBY), providerRule());
    expect(res.matched).toBe(true);
    expect(res.acceptAsIs).toBe(true);
  });

  it('accepts as-is when the requested window sits inside working hours', () => {
    const res = matchIntent(serviceIntent(HANOI_NEARBY, todayAt(10, 0, 120)), providerRule());
    expect(res.matched).toBe(true);
    expect(res.acceptAsIs).toBe(true);
    expect(res.counterTerms).toBeUndefined();
  });

  it('counters with the clamped window (and the rule price) on partial overlap', () => {
    // Request 08:00–10:00 vs working 09:00–17:00 → overlap starts at 09:00.
    const res = matchIntent(serviceIntent(HANOI_NEARBY, todayAt(8, 0, 120)), providerRule());
    expect(res.matched).toBe(true);
    expect(res.acceptAsIs).toBeUndefined();
    const counter = res.counterTerms!;
    expect(new Date(counter.window!.start * 1000).getHours()).toBe(9);
    expect(counter.payment).toBe('USD 50');
  });

  it('shifts into working hours when the gap is within flexibility', () => {
    // Request 08:00–08:30, 60min flex → shifted to open at 09:00.
    const res = matchIntent(serviceIntent(HANOI_NEARBY, todayAt(8, 0, 30)), providerRule());
    expect(res.matched).toBe(true);
    expect(new Date(res.counterTerms!.window!.start * 1000).getHours()).toBe(9);
    expect(res.counterTerms!.note).toMatch(/shifted/);
  });

  it('rejects when the request is beyond flexibility', () => {
    // Request 06:00–06:30, 60min flex → still 2.5h before opening.
    const res = matchIntent(serviceIntent(HANOI_NEARBY, todayAt(6, 0, 30)), providerRule({ flex_minutes: 60 }));
    expect(res.matched).toBe(false);
    expect(res.reason).toMatch(/no time overlap/);
  });

  it('never matches its own side (provider rule vs provider offer)', () => {
    const offer = { ...serviceIntent(HANOI_NEARBY), content: { ...serviceIntent(HANOI_NEARBY).content, side: 'offer' as const } };
    expect(matchIntent(offer as Intent, providerRule()).matched).toBe(false);
  });
});
