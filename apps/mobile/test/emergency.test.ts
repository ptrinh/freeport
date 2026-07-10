import { describe, it, expect } from 'vitest';
import { policeNumberFor } from '../src/emergency';

describe('policeNumberFor', () => {
  it('returns the country-specific police line', () => {
    expect(policeNumberFor('SG')).toBe('999');
    expect(policeNumberFor('TH')).toBe('191');
    expect(policeNumberFor('US')).toBe('911');
    expect(policeNumberFor('MY')).toBe('999');
    expect(policeNumberFor('BR')).toBe('190');
    expect(policeNumberFor('AU')).toBe('000');
    expect(policeNumberFor('DE')).toBe('110');
  });

  it('is case/whitespace tolerant', () => {
    expect(policeNumberFor('sg')).toBe('999');
    expect(policeNumberFor(' th ')).toBe('191');
  });

  it('falls back to 112 for unknown, Other, or empty', () => {
    expect(policeNumberFor('XX')).toBe('112');
    expect(policeNumberFor('ZQ')).toBe('112');
    expect(policeNumberFor('')).toBe('112');
    expect(policeNumberFor(undefined)).toBe('112');
    expect(policeNumberFor(null)).toBe('112');
  });
});
