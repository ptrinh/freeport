/**
 * COUNTRY_NAME / COUNTRY_CODES_AZ used to be re-declared from COUNTRIES in
 * several UI files. Phase 7 of the App.tsx split gave them a single home in
 * src/locations.ts. These tests lock in that home: the derived lookups must
 * stay in sync with COUNTRIES (their only source of truth).
 */
import { describe, it, expect } from 'vitest';
import { COUNTRIES, COUNTRY_NAME, COUNTRY_CODES_AZ, countryByCode } from '../src/locations';

describe('COUNTRY_NAME (code → name lookup)', () => {
  it('maps every country code to its name', () => {
    for (const c of COUNTRIES) {
      expect(COUNTRY_NAME[c.code]).toBe(c.name);
    }
  });

  it('agrees with countryByCode', () => {
    expect(COUNTRY_NAME['TH']).toBe('Thailand');
    expect(COUNTRY_NAME['SG']).toBe('Singapore');
    expect(COUNTRY_NAME['US']).toBe(countryByCode('US')!.name);
  });

  it('has exactly one entry per country (no duplicate codes)', () => {
    expect(Object.keys(COUNTRY_NAME)).toHaveLength(COUNTRIES.length);
  });
});

describe('COUNTRY_CODES_AZ (codes sorted A–Z by name)', () => {
  it('covers every country exactly once', () => {
    expect(COUNTRY_CODES_AZ).toHaveLength(COUNTRIES.length);
    expect(new Set(COUNTRY_CODES_AZ).size).toBe(COUNTRIES.length);
    for (const c of COUNTRIES) expect(COUNTRY_CODES_AZ).toContain(c.code);
  });

  it('pins "Other" first, then A–Z by country name', () => {
    expect(COUNTRY_CODES_AZ[0]).toBe('XX');
    expect(COUNTRY_NAME['XX']).toBe('Other');
    const names = COUNTRY_CODES_AZ.slice(1).map((code) => COUNTRY_NAME[code]);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
});
