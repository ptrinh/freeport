import { describe, it, expect } from 'vitest';
import { parseLocaleAmount } from '../src/money';

describe('parseLocaleAmount', () => {
  // Regression: a Vietnamese-formatted "5,50" was read as 550 by parseFloat,
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
