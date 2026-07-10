/**
 * Regression: with the pref on Auto (and even after switching to km), Browse
 * showed miles — distance chips and the "nearest is 194.53mi away" empty
 * state — while the Settings label said km. Two rules under test:
 *
 * 1. effectiveUnit() is the single source of truth: Browse and Settings both
 *    resolve through it with the same inputs, so they cannot disagree.
 * 2. formatDistance() rounds BEFORE Intl — engines that ignore
 *    maximumFractionDigits for style:'unit' (Hermes) rendered "194.53mi".
 */
import { describe, it, expect, vi } from 'vitest';
(globalThis as any).__DEV__ = false; // expo-modules-core reads it at import time
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-location', () => ({}));
import { effectiveUnit, formatDistance, usesMiles } from '../src/maps';

describe('effectiveUnit — single source of truth for km/mi', () => {
  it('explicit preference always wins, regardless of country', () => {
    expect(effectiveUnit('km', 'US')).toBe('km');
    expect(effectiveUnit('mi', 'VN')).toBe('mi');
  });

  it("the reported case: Auto in Vietnam → km (NOT miles)", () => {
    expect(effectiveUnit('auto', 'VN')).toBe('km');
  });

  it('Auto follows the country: mile countries → mi, others → km', () => {
    expect(effectiveUnit('auto', 'US')).toBe('mi');
    expect(effectiveUnit('auto', 'GB')).toBe('mi');
    expect(effectiveUnit('auto', 'SG')).toBe('km');
    expect(effectiveUnit('auto', 'de')).toBe('km');
  });

  it('legacy/missing pref values behave as Auto, never crash', () => {
    expect(effectiveUnit(undefined, 'VN')).toBe('km');
    expect(effectiveUnit(null, 'US')).toBe('mi');
    expect(effectiveUnit('', undefined)).toBe('km');
    expect(effectiveUnit('AUTO', 'VN')).toBe('km'); // unknown string ≠ km/mi → auto
  });

  it('agrees with usesMiles for the auto path', () => {
    for (const c of ['US', 'GB', 'LR', 'MM']) expect(effectiveUnit('auto', c)).toBe('mi');
  });
});

describe('formatDistance — rounds before Intl (Hermes maximumFractionDigits bug)', () => {
  it('the reported value: 313 km shown in miles is "195 mi", never "194.53mi"', () => {
    const s = formatDistance(313.06, 'VN', 'mi');
    expect(s).toMatch(/195/);
    expect(s).not.toMatch(/194\.5/);
  });

  it('same distance in km stays km', () => {
    const s = formatDistance(313.06, 'VN', 'km');
    expect(s).toMatch(/313/);
    expect(s).toMatch(/km/);
    expect(s).not.toMatch(/mi/);
  });

  it('short distances keep one decimal', () => {
    expect(formatDistance(4.26, 'VN', 'km')).toMatch(/4[.,]3/);
  });

  it('explicit unit beats the country fallback', () => {
    expect(formatDistance(100, 'US', 'km')).toMatch(/km/);
  });
});
