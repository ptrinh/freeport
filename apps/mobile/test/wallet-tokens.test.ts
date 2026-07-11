import { describe, it, expect } from 'vitest';
import { toBaseUnits, fromBaseUnits, formatBaseUnits } from '../src/wallet/tokens';
import { mapSparkPayments } from '../src/wallet/breezMap';

describe('token unit conversion', () => {
  it('parses decimal strings exactly (no float drift)', () => {
    expect(toBaseUnits('12.34', 6)).toBe(12340000n);
    expect(toBaseUnits('0.000001', 6)).toBe(1n);
    expect(toBaseUnits('5', 6)).toBe(5000000n);
    expect(toBaseUnits(2.5, 2)).toBe(250n);
  });

  it('truncates excess precision instead of rounding up funds', () => {
    expect(toBaseUnits('1.9999999', 6)).toBe(1999999n);
  });

  it('rejects garbage', () => {
    expect(() => toBaseUnits('abc', 6)).toThrow('bad-amount');
    expect(() => toBaseUnits('-5', 6)).toThrow('bad-amount');
    expect(() => toBaseUnits('1,5', 6)).toThrow('bad-amount');
  });

  it('round-trips display values', () => {
    expect(fromBaseUnits(12340000n, 6)).toBe(12.34);
    expect(formatBaseUnits(12340000n, 6)).toBe('12.34');
    expect(formatBaseUnits(5000000n, 6)).toBe('5');
    expect(formatBaseUnits(1n, 6)).toBe('0.000001');
    expect(formatBaseUnits(0n, 6)).toBe('0');
  });
});

describe('mapSparkPayments — token payments', () => {
  it('maps token transfers to human amounts with tickers', () => {
    const [tx] = mapSparkPayments([{
      paymentType: 'receive', status: 'completed', amount: 12500000n, timestamp: 100,
      details: { type: 'token', metadata: { ticker: 'USDT', decimals: 6 } },
    }]);
    expect(tx.token).toEqual({ ticker: 'USDT', amount: 12.5 });
    expect(tx.sats).toBe(0);
    expect(tx.direction).toBe('in');
  });

  it('keeps sats semantics for BTC rails', () => {
    const [tx] = mapSparkPayments([{
      paymentType: 'send', status: 'completed', amount: 777n, timestamp: 100,
      details: { type: 'lightning', description: 'coffee' },
    }]);
    expect(tx.token).toBeUndefined();
    expect(tx.sats).toBe(777);
  });
});
