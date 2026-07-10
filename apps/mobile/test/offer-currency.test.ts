/**
 * Regression: an unpriced ride with a VIETNAM pickup, posted into a Singapore
 * market topic (poster's selected location), prefilled the respond form with
 * S$ — a ride is paid at the curb in the PICKUP country's money, so it must
 * offer ₫. offerCurrency() is the resolution order under test:
 * explicit asking price → pickup country → market topic → USD.
 */
import { describe, it, expect } from 'vitest';
import { offerCurrency } from '../src/locations';

describe('offerCurrency', () => {
  it('the reported case: unpriced, VN pickup, SG market → VND (not SGD)', () => {
    expect(offerCurrency(null, 'VN', 'sg_singapore_ridesharing')).toBe('VND');
  });

  it('an explicit asking price wins over everything', () => {
    expect(offerCurrency('SGD', 'VN', 'vn_hanoi_ridesharing')).toBe('SGD');
  });

  it('pickup country wins over the market topic', () => {
    expect(offerCurrency(null, 'TH', 'vn_hanoi_ridesharing')).toBe('THB');
    expect(offerCurrency(undefined, 'sg', 'vn_hanoi_ridesharing')).toBe('SGD'); // case-insensitive
  });

  it('no pickup country → market topic country', () => {
    expect(offerCurrency(null, null, 'vn_hanoi_ridesharing')).toBe('VND');
    expect(offerCurrency(null, undefined, 'sg-rideshare')).toBe('SGD');
  });

  it('unknown pickup country falls through to the market', () => {
    expect(offerCurrency(null, 'ZZ', 'vn_hanoi_ridesharing')).toBe('VND');
  });

  it('nothing known → USD', () => {
    expect(offerCurrency(null, null, undefined)).toBe('USD');
    expect(offerCurrency(null, 'ZZ', 'not-a-market')).toBe('USD');
  });
});
