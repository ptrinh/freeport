/**
 * Regression: an unpriced ride with a THAILAND pickup, posted into a Malaysian
 * market topic (poster's selected location), prefilled the respond form with
 * RM — a ride is paid at the curb in the PICKUP country's money, so it must
 * offer ฿. offerCurrency() is the resolution order under test:
 * explicit asking price → pickup country → market topic → USD.
 */
import { describe, it, expect } from 'vitest';
import { offerCurrency } from '../src/locations';

describe('offerCurrency', () => {
  it('the reported case: unpriced, TH pickup, MY market → THB (not MYR)', () => {
    expect(offerCurrency(null, 'TH', 'my_kuala_lumpur_ridesharing')).toBe('THB');
  });

  it('an explicit asking price wins over everything', () => {
    expect(offerCurrency('SGD', 'TH', 'th_bangkok_ridesharing')).toBe('SGD');
  });

  it('pickup country wins over the market topic', () => {
    expect(offerCurrency(null, 'TH', 'id_jakarta_ridesharing')).toBe('THB');
    expect(offerCurrency(undefined, 'my', 'th_bangkok_ridesharing')).toBe('MYR'); // case-insensitive
  });

  it('no pickup country → market topic country', () => {
    expect(offerCurrency(null, null, 'th_bangkok_ridesharing')).toBe('THB');
    expect(offerCurrency(null, undefined, 'my-rideshare')).toBe('MYR');
  });

  it('unknown pickup country falls through to the market', () => {
    expect(offerCurrency(null, 'ZZ', 'th_bangkok_ridesharing')).toBe('THB');
  });

  it('nothing known → USD', () => {
    expect(offerCurrency(null, null, undefined)).toBe('USD');
    expect(offerCurrency(null, 'ZZ', 'not-a-market')).toBe('USD');
  });
});
