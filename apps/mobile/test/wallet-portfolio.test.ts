import { describe, it, expect } from 'vitest';
import { totalFiat, formatFiat, formatPillAmount, effectiveUnit } from '../src/wallet/portfolio';

const USDT = { id: 'usdt', ticker: 'USDT', name: 'Tether', decimals: 6, amount: 70.5 };
const USDB = { id: 'usdb', ticker: 'USDB', name: 'USDB', decimals: 6, amount: 20.01 };
const ZERO = { id: 'zero', ticker: 'ZERO', name: 'Zero', decimals: 6, amount: 0 };

describe('totalFiat (header total = BTC + USD-pegged stablecoins)', () => {
  // 10,000 sats at 64,000 USD/BTC = $6.40; tokens 70.5 + 20.01 = $90.51
  it('sums BTC and tokens in USD', () => {
    expect(totalFiat('usd', 10_000, [USDT, USDB], 64_000, null)).toBeCloseTo(96.91, 2);
  });

  it('crosses tokens through USD→local for the local unit', () => {
    // localRate 2,560,000,000 VND/BTC, usdRate 64,000 → USD→VND = 40,000
    // BTC: 10,000 sats → 256,000 VND; tokens: 90.51 USD → 3,620,400 VND
    expect(totalFiat('local', 10_000, [USDT, USDB], 64_000, 2_560_000_000)).toBeCloseTo(3_876_400, 0);
  });

  it('ignores zero balances and works with no tokens', () => {
    expect(totalFiat('usd', 10_000, [ZERO], 64_000, null)).toBeCloseTo(6.4, 2);
    expect(totalFiat('usd', 10_000, [], 64_000, null)).toBeCloseTo(6.4, 2);
  });

  it('null when the needed rate is missing (caller falls back)', () => {
    expect(totalFiat('usd', 10_000, [USDT], null, 123)).toBeNull();
    expect(totalFiat('local', 10_000, [USDT], 64_000, null)).toBeNull();
    // local unit needs usdRate too (token cross rate)
    expect(totalFiat('local', 10_000, [USDT], null, 2_560_000_000)).toBeNull();
    expect(totalFiat('usd', null, [USDT], 64_000, null)).toBeNull();
  });
});

describe('locale-aware separators', () => {
  it('vi-VN groups with dots, en-US with commas', () => {
    expect(formatPillAmount(10_000, 'vi-VN')).toBe('10.000');
    expect(formatPillAmount(10_000, 'en-US')).toBe('10,000');
    expect(formatPillAmount(70.5, 'en-US')).toBe('70.5');
    expect(formatPillAmount(70.5, 'vi-VN')).toBe('70,5');
  });

  it('caps pills at two fraction digits', () => {
    expect(formatPillAmount(20.0149, 'en-US')).toBe('20.01');
    expect(formatPillAmount(1.005001, 'en-US')).toBe('1.01');
  });

  it('currency formatting follows the locale and the currency minor units', () => {
    expect(formatFiat(610_000, 'VND', 'vi-VN')).toBe('610.000 ₫');
    expect(formatFiat(25, 'USD', 'en-US')).toBe('$25.00');
    const sgd = formatFiat(7.5, 'SGD', 'en-US');
    expect(sgd).toMatch(/7\.50/); // cents preserved for decimal currencies
  });
});


describe('effectiveUnit (what the header can actually honor)', () => {
  it("'local' shows local when the rate exists", () => {
    expect(effectiveUnit('local', 64_000, 2_560_000_000)).toBe('local');
  });
  it("'local' degrades to USD for USD-market users / missing local rate", () => {
    expect(effectiveUnit('local', 64_000, null)).toBe('usd');
  });
  it('degrades all the way to sats with no rates at all (NWC)', () => {
    expect(effectiveUnit('local', null, null)).toBe('sats');
    expect(effectiveUnit('usd', null, null)).toBe('sats');
  });
  it('explicit sats stays sats', () => {
    expect(effectiveUnit('sats', 64_000, 2_560_000_000)).toBe('sats');
  });
});
