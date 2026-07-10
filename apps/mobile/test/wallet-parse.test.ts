import { describe, it, expect } from 'vitest';
import { NwcProvider, parseNwcUrl } from '../src/wallet/nwc';
import { qrDataUrl } from '../src/wallet/qr';

const CONN = parseNwcUrl(`nostr+walletconnect://${'b'.repeat(64)}?relay=wss://r.example&secret=${'c'.repeat(64)}`)!;

describe('NwcProvider.parse (Send destination classification)', () => {
  const p = new NwcProvider(CONN);

  it('classifies bolt11 invoices and extracts the amount', async () => {
    const d = await p.parse('lnbc2500n1p0xyzabc');
    expect(d).toMatchObject({ kind: 'bolt11', sats: 250 });
  });

  it('strips a lightning: prefix', async () => {
    const d = await p.parse('lightning:lnbc10u1p0xyzabc');
    expect(d.kind).toBe('bolt11');
    expect(d.raw.startsWith('lnbc')).toBe(true);
  });

  it('amountless bolt11 → sats null (amount step in the UI)', async () => {
    const d = await p.parse('lnbc1qqqqqqqq');
    expect(d).toMatchObject({ kind: 'bolt11', sats: null });
  });

  it('classifies lightning addresses and lnurl', async () => {
    expect((await p.parse('user@getalby.com')).kind).toBe('lightningAddress');
    expect((await p.parse('LNURL1DP68GURN8GHJ7'.toLowerCase())).kind).toBe('lnurlPay');
  });

  it('everything else is unknown (NWC cannot pay it)', async () => {
    expect((await p.parse('bc1qxyz')).kind).toBe('unknown');
    expect((await p.parse('sp1pgss9xyz')).kind).toBe('unknown');
  });

  it('has no rate feed or on-chain receive', async () => {
    expect(await p.usdRate()).toBeNull();
    expect(await p.receiveOnchain()).toBeNull();
  });

  p.close();
});

describe('qrDataUrl', () => {
  it('renders a GIF data URI', () => {
    const uri = qrDataUrl('lnbc2500n1p0xyzabc');
    expect(uri.startsWith('data:image/gif;base64,')).toBe(true);
    expect(uri.length).toBeGreaterThan(500);
  });

  it('scales with content and stays deterministic', () => {
    expect(qrDataUrl('abc')).toBe(qrDataUrl('abc'));
    expect(qrDataUrl('abc')).not.toBe(qrDataUrl('abd'));
  });
});
