import { describe, it, expect } from 'vitest';
import { parseLocaleAmount, parseAmountWithK } from '../src/money';

describe('parseLocaleAmount', () => {
  // Regression: a comma-decimal "5,50" (German/French style) was read as 550 by parseFloat,
  // turning a 5.50 SGD counter-offer into 550 SGD. (commit on the money round-trip)
  it('reads a comma decimal without inflating it', () => {
    expect(parseLocaleAmount('5,50')).toBe(5.5);
    expect(parseLocaleAmount('S$5,50')).toBe(5.5);
  });

  it('reads a dot decimal', () => {
    expect(parseLocaleAmount('5.50')).toBe(5.5);
    expect(parseLocaleAmount('$5.50')).toBe(5.5);
  });

  it('treats a 3-digit trailing group as thousands, not a decimal', () => {
    expect(parseLocaleAmount('5.500')).toBe(5500);
    expect(parseLocaleAmount('5,500')).toBe(5500);
    expect(parseLocaleAmount('50.000')).toBe(50000);
  });

  it('handles grouped + decimal in both conventions', () => {
    expect(parseLocaleAmount('1,234.56')).toBe(1234.56);
    expect(parseLocaleAmount('1.234,56')).toBe(1234.56);
  });

  it('handles plain integers and strips currency text', () => {
    expect(parseLocaleAmount('550')).toBe(550);
    expect(parseLocaleAmount('550 SGD')).toBe(550);
  });

  it('returns 0 for empty or non-numeric input', () => {
    expect(parseLocaleAmount('')).toBe(0);
    expect(parseLocaleAmount('abc')).toBe(0);
  });
});

describe('parseLocaleAmount with fractionDigits', () => {
  it('keeps 3-decimal minor units for KWD-style currencies', () => {
    expect(parseLocaleAmount('5.500', 3)).toBe(5.5);
    expect(parseLocaleAmount('KWD 1.250', 3)).toBe(1.25);
  });

  it('still treats a trailing 3-digit group as thousands for 0/2-digit currencies', () => {
    expect(parseLocaleAmount('5.500', 0)).toBe(5500);
    expect(parseLocaleAmount('5.500', 2)).toBe(5500);
  });
});

describe('parseAmountWithK', () => {
  it('multiplies the locale-parsed number, not its bare digits', () => {
    // Regression: "12.5k" was read as digits "125" × 1000 = 125,000.
    expect(parseAmountWithK('12.5k', 0)).toBe(12500);
    expect(parseAmountWithK('12,5k', 0)).toBe(12500);
    expect(parseAmountWithK('50k', 0)).toBe(50000);
  });

  it('falls through to parseLocaleAmount without a k suffix', () => {
    expect(parseAmountWithK('5,50', 2)).toBe(5.5);
    expect(parseAmountWithK('50.000₫', 0)).toBe(50000);
    expect(parseAmountWithK('5.500', 3)).toBe(5.5);
  });
});
