import { describe, it, expect } from 'vitest';
import { bolt11Sats } from '../src/wallet/bolt11';
import { isLightningAddress } from '../src/wallet/lnurl';

describe('bolt11Sats', () => {
  it('decodes the common multipliers', () => {
    expect(bolt11Sats('lnbc10u1p0xyz')).toBe(1000);      // 10 µBTC
    expect(bolt11Sats('lnbc2500n1p0xyz')).toBe(250);     // 2500 nBTC
    expect(bolt11Sats('lnbc1m1p0xyz')).toBe(100_000);    // 1 mBTC
    expect(bolt11Sats('lnbc21p0xyz'.replace('21p','2m1p'))).toBe(200_000);
    expect(bolt11Sats('LNBC10U1P0XYZ')).toBe(1000);      // uppercase form
  });

  it('handles whole-BTC and testnet prefixes', () => {
    expect(bolt11Sats('lnbc11p0xyz'.replace('11p','1' + '1p'))).toBe(100_000_000); // 1 BTC
    expect(bolt11Sats('lntb500u1p0xyz')).toBe(50_000);
  });

  it('rejects amountless, sub-sat and garbage', () => {
    expect(bolt11Sats('lnbc1p0xyz')).toBeNull();     // no amount (digits then 'p'?? -> 1 pBTC, sub-sat)
    expect(bolt11Sats('lnbc10p1p0xyz')).toBeNull();  // 10 pBTC = 0.001 sat
    expect(bolt11Sats('lnbc1' + 'q'.repeat(20))).toBeNull(); // amountless: ln…1 straight into data
    expect(bolt11Sats('not an invoice')).toBeNull();
    expect(bolt11Sats('')).toBeNull();
  });
});

describe('isLightningAddress', () => {
  it('accepts user@domain and rejects the rest', () => {
    expect(isLightningAddress('phil@getalby.com')).toBe(true);
    expect(isLightningAddress('a.b+c@ln.example.org')).toBe(true);
    expect(isLightningAddress('sprt1qqxyz')).toBe(false); // spark address
    expect(isLightningAddress('lnbc10u1p0xyz')).toBe(false);
    expect(isLightningAddress('user@localhost')).toBe(false); // no TLD
  });
});
