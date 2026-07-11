import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' }, StyleSheet: { create: (x: any) => x }, Dimensions: { get: () => ({ width: 390, height: 844 }) } }));
import { satsForFiat, dealFiat } from '../src/wallet/fiatConvert';

describe('satsForFiat', () => {
  it('converts an agreed fiat price at the BTC rate', () => {
    // 5 SGD at 130,000 SGD/BTC → ~3846 sats
    expect(satsForFiat(5, 130_000)).toBe(3846);
    // 50,000 VND at 2.6B VND/BTC → ~1923 sats
    expect(satsForFiat(50_000, 2_600_000_000)).toBe(1923);
  });

  it('never yields junk on missing inputs', () => {
    expect(satsForFiat(0, 130_000)).toBe(0);
    expect(satsForFiat(5, 0)).toBe(0);
    expect(satsForFiat(NaN, 130_000)).toBe(0);
  });
});

describe('dealFiat (deal payment string → {amount, currency})', () => {
  it('frames the currency by the deal market', () => {
    expect(dealFiat('S$5', 'sg-rideshare', 'SG')).toEqual({ amount: 5, currency: 'SGD' });
    expect(dealFiat('RM12', 'my-rideshare', 'MY')).toEqual({ amount: 12, currency: 'MYR' });
  });

  it('detects VND formatting regardless of frame', () => {
    const f = dealFiat('50.000 ₫', 'sg-rideshare', 'SG');
    expect(f?.currency).toBe('VND');
    expect(f?.amount).toBe(50_000);
  });

  it('null when the deal has no price', () => {
    expect(dealFiat(undefined, 'sg-rideshare', 'SG')).toBeNull();
    expect(dealFiat('', 'sg-rideshare', 'SG')).toBeNull();
  });
});
