/**
 * Bug report: a user in one country with their location set to a city abroad
 * opened an offer on an UNPRICED Bangkok ride and the currency defaulted to SGD
 * (hardcoded fallback) instead of VND. Offers/counters must default to the
 * POST's market currency — market slugs lead with the ISO country code.
 */
import { describe, it, expect } from 'vitest';
import { currencyForMarket } from '../src/locations';

describe('currencyForMarket (offer defaults follow the post, not the viewer)', () => {
  it('the reported case: Bangkok market → THB regardless of where the viewer sits', () => {
    expect(currencyForMarket('th_bangkok_ridesharing', 'SGD')).toBe('THB');
    expect(currencyForMarket('th_bangkok', 'USD')).toBe('THB');
  });

  it('other markets resolve by their leading country code', () => {
    expect(currencyForMarket('sg_singapore_ridesharing', 'USD')).toBe('SGD');
    expect(currencyForMarket('us_nassaucounty_ridesharing', 'VND')).toBe('USD');
    expect(currencyForMarket('th_bangkok', 'USD')).toBe('THB');
  });

  it('legacy demo market key (dash-separated) still resolves', () => {
    expect(currencyForMarket('sg-rideshare', 'USD')).toBe('SGD');
  });

  it('falls back when the market carries no country', () => {
    expect(currencyForMarket('global', 'VND')).toBe('VND');       // no country segment
    expect(currencyForMarket('', 'USD')).toBe('USD');
    expect(currencyForMarket(undefined, 'EUR')).toBe('EUR');
    expect(currencyForMarket('zz_nowhere', 'USD')).toBe('USD');    // unknown country code
  });
});
