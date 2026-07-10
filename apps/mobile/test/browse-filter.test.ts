/**
 * Regression: user raised Max distance to 1000 km and Browse STILL hid every
 * post ("2 posts are outside your area — the nearest is ~313 km away"). The
 * old code applied the hardcoded NEAR_KM=200 rides filter first, so the Max
 * distance preference could only shrink the radius, never widen it.
 */
import { describe, it, expect } from 'vitest';
import { NEAR_KM, maxKmOf, passesDistance } from '../src/browseFilter';

const RIDE = true, SERVICE = false;

describe('user preference overrides the default locality radius', () => {
  it('the reported case: ride 313 km away, Max distance 1000 km → visible', () => {
    expect(passesDistance(RIDE, 313, 1000, 'km')).toBe(true);
  });

  it('same in miles: 313 km ≈ 194.5 mi, Max distance 1000 mi → visible', () => {
    expect(passesDistance(RIDE, 313, 1000, 'mi')).toBe(true);
  });

  it('preference also shrinks: ride 100 km away, Max distance 50 km → hidden', () => {
    expect(passesDistance(RIDE, 100, 50, 'km')).toBe(false);
  });

  it('mi is converted, not compared raw: 90 km ride vs Max 50 mi (~80 km) → hidden', () => {
    expect(passesDistance(RIDE, 90, 50, 'mi')).toBe(false);
    expect(passesDistance(RIDE, 75, 50, 'mi')).toBe(true);
    expect(maxKmOf(50, 'mi')).toBeCloseTo(80.47, 1);
  });
});

describe('defaults when no Max distance is set (0/unset)', () => {
  it(`rides fall back to NEAR_KM=${NEAR_KM}`, () => {
    expect(passesDistance(RIDE, NEAR_KM - 1, 0, 'km')).toBe(true);
    expect(passesDistance(RIDE, NEAR_KM + 1, 0, 'km')).toBe(false);
  });

  it('services/goods are unbounded by default', () => {
    expect(passesDistance(SERVICE, 5000, 0, 'km')).toBe(true);
  });

  it('services respect an explicit Max distance', () => {
    expect(passesDistance(SERVICE, 120, 100, 'km')).toBe(false);
    expect(passesDistance(SERVICE, 80, 100, 'km')).toBe(true);
  });
});

describe('unknown distance never hides a post', () => {
  it('no geohash / no reference → visible regardless of settings', () => {
    expect(passesDistance(RIDE, null, 0, 'km')).toBe(true);
    expect(passesDistance(RIDE, null, 10, 'km')).toBe(true);
    expect(passesDistance(SERVICE, null, 10, 'mi')).toBe(true);
  });
});
