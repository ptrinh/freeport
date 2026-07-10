/**
 * Regression: with the Service/Product vertical OFF, the Browse feed ignored
 * the subcategory (vehicle class) entirely — Settings said "Compact Car" but a
 * "Luxury Car" request still showed (user report). The old code skipped the
 * whole category filter when the vertical was off.
 */
import { describe, it, expect } from 'vitest';
import { passesCategory } from '../src/browseFilter';
import { RIDESHARE_CATEGORY, DEFAULT_RIDESHARE_SUBCATEGORY } from '../src/categories';

const ride = (vehicle?: string) => ({ schema: 'rideshare/request/v1', payload: vehicle ? { category: vehicle } : {} });
const service = (cat: string, sub?: string) => ({ schema: 'service/listing/v1', payload: { category: cat, subcategory: sub } });

describe('vertical OFF (rideshare-only feed) — the reported bug', () => {
  const OFF = false;

  it('Luxury Car request is hidden when the filter is Compact Car', () => {
    const lux = ride('Luxury Car');
    expect(passesCategory(lux.schema, lux.payload, OFF, RIDESHARE_CATEGORY, 'Compact Car')).toBe(false);
  });

  it('Compact Car request passes the Compact Car filter', () => {
    const compact = ride(DEFAULT_RIDESHARE_SUBCATEGORY);
    expect(passesCategory(compact.schema, compact.payload, OFF, RIDESHARE_CATEGORY, 'Compact Car')).toBe(true);
  });

  it('no subcategory selected (null) → all vehicle classes show', () => {
    const lux = ride('Luxury Car');
    expect(passesCategory(lux.schema, lux.payload, OFF, RIDESHARE_CATEGORY, null)).toBe(true);
  });

  it('category mismatch is NOT enforced when the vertical is off (schema already scopes the feed)', () => {
    const compact = ride('Compact Car');
    expect(passesCategory(compact.schema, compact.payload, OFF, 'Home Services', 'Compact Car')).toBe(true);
  });
});

describe('vertical ON — behavior unchanged', () => {
  const ON = true;

  it('category must match', () => {
    const s = service('Home Services', 'Cleaning');
    expect(passesCategory(s.schema, s.payload, ON, 'Home Services', 'Cleaning')).toBe(true);
    expect(passesCategory(s.schema, s.payload, ON, RIDESHARE_CATEGORY, null)).toBe(false);
  });

  it('subcategory must match within the category', () => {
    const s = service('Home Services', 'Cleaning');
    expect(passesCategory(s.schema, s.payload, ON, 'Home Services', 'Repairs')).toBe(false);
  });

  it('rides filter by vehicle class exactly as with the vertical off', () => {
    const lux = ride('Luxury Car');
    expect(passesCategory(lux.schema, lux.payload, ON, RIDESHARE_CATEGORY, 'Compact Car')).toBe(false);
    expect(passesCategory(lux.schema, lux.payload, ON, RIDESHARE_CATEGORY, 'Luxury Car')).toBe(true);
  });
});
