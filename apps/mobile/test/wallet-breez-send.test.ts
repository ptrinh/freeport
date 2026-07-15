import { describe, it, expect, vi, beforeEach } from 'vitest';

// breez.ts statically imports react-native + identity (→ kv/expo) + the native
// Breez TurboModule shim. Stub them so the pure provider logic is testable in
// the node env; breezShapes/tokens/breezMap stay real (pay() routing uses them).
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('../src/identity', () => ({ loadKey: vi.fn() }));
vi.mock('../src/wallet/breezNative', () => ({ importBreezNative: vi.fn() }));
// The SDK's lazy web/storage subpaths (loaded only inside connectBreez, never
// in these tests) confuse Vite's static import analysis — stub the specifiers.
vi.mock('@breeztech/breez-sdk-spark/web', () => ({ default: vi.fn() }));
vi.mock('@breeztech/breez-sdk-spark/storage', () => ({ createDefaultStorage: vi.fn() }));

import { BreezSparkProvider } from '../src/wallet/breez';

/** Records every SDK call so we can assert which flow pay() chose. */
function mockSdk(parseResult: any) {
  const calls: Record<string, any[]> = {};
  const rec = (name: string) => (...args: any[]) => {
    (calls[name] ||= []).push(args[0]);
    if (name === 'parse') return Promise.resolve(parseResult);
    if (name === 'prepareLnurlPay') return Promise.resolve({ prep: 'lnurl' });
    if (name === 'prepareSendPayment') return Promise.resolve({ prep: 'send' });
    return Promise.resolve({ payment: { status: 'completed' } }); // lnurlPay / sendPayment
  };
  return {
    calls,
    parse: rec('parse'),
    prepareLnurlPay: rec('prepareLnurlPay'),
    lnurlPay: rec('lnurlPay'),
    prepareSendPayment: rec('prepareSendPayment'),
    sendPayment: rec('sendPayment'),
  };
}

describe('BreezSparkProvider.pay — destination routing', () => {
  it('routes a lightning address through the LNURL-pay flow (web shape)', async () => {
    const payRequest = { callback: 'https://freeport.network/cb', minSendable: 1000, maxSendable: 1e9 };
    const sdk = mockSdk({ type: 'lightningAddress', address: 'alice@freeport.network', payRequest });
    const p = new BreezSparkProvider(sdk, null);

    await p.pay('alice@freeport.network', 1500);

    expect(sdk.calls.prepareLnurlPay).toHaveLength(1);
    expect(sdk.calls.prepareLnurlPay[0]).toEqual({ amount: 1500n, payRequest });
    expect(sdk.calls.lnurlPay).toHaveLength(1);
    // Must NOT hit the SendPayment path that rejects with "Unsupported payment method".
    expect(sdk.calls.prepareSendPayment).toBeUndefined();
  });

  it('routes a bare LNURL through the LNURL-pay flow (details are the payRequest)', async () => {
    const details = { type: 'lnurlPay', callback: 'https://pay.example/cb', minSendable: 1000, maxSendable: 1e9 };
    const sdk = mockSdk(details);
    const p = new BreezSparkProvider(sdk, null);

    await p.pay('LNURL1DP68GURN8GHJ7', 2000);

    expect(sdk.calls.prepareLnurlPay[0]).toEqual({ amount: 2000n, payRequest: details });
    expect(sdk.calls.lnurlPay).toHaveLength(1);
    expect(sdk.calls.prepareSendPayment).toBeUndefined();
  });

  it('bridges the native uniffi shape (tag + inner[0]) for lightning addresses', async () => {
    const payRequest = { callback: 'https://freeport.network/cb', minSendable: 1000, maxSendable: 1e9 };
    // native: PascalCase tag + positional inner; M is the native module namespace.
    const sdk = mockSdk({ tag: 'LightningAddress', inner: [{ address: 'bob@x.com', payRequest }] });
    const p = new BreezSparkProvider(sdk, {} /* M non-null */);

    await p.pay('bob@x.com', 500);

    expect(sdk.calls.prepareLnurlPay[0]).toEqual({ amount: 500n, payRequest });
    expect(sdk.calls.prepareSendPayment).toBeUndefined();
  });

  it('sends a bolt11 invoice via SendPayment (no LNURL, no extra parse)', async () => {
    const sdk = mockSdk({ type: 'bolt11Invoice' });
    const p = new BreezSparkProvider(sdk, null);

    await p.pay('lnbc2500n1p0xyzabc');

    expect(sdk.calls.prepareSendPayment).toHaveLength(1);
    expect(sdk.calls.sendPayment).toHaveLength(1);
    expect(sdk.calls.prepareLnurlPay).toBeUndefined();
    // bolt11 short-circuits before the pre-parse.
    expect(sdk.calls.parse).toBeUndefined();
  });

  it('sends a Spark address via SendPayment, not the LNURL flow', async () => {
    const sdk = mockSdk({ type: 'sparkAddress' });
    const p = new BreezSparkProvider(sdk, null);

    await p.pay('sp1pgss9xyz', 1000);

    expect(sdk.calls.prepareSendPayment).toHaveLength(1);
    expect(sdk.calls.prepareSendPayment[0].amount).toBe(1000n);
    expect(sdk.calls.prepareLnurlPay).toBeUndefined();
  });

  it('requires an amount for non-bolt11 destinations', async () => {
    const sdk = mockSdk({ type: 'lightningAddress', payRequest: {} });
    const p = new BreezSparkProvider(sdk, null);

    await expect(p.pay('alice@freeport.network')).rejects.toThrow('amount-required');
    expect(sdk.calls.parse).toBeUndefined();
  });

  it('surfaces a failed LNURL payment', async () => {
    const sdk = mockSdk({ type: 'lightningAddress', payRequest: {} });
    sdk.lnurlPay = () => Promise.resolve({ payment: { status: 'failed' } });
    const p = new BreezSparkProvider(sdk, null);

    await expect(p.pay('alice@freeport.network', 100)).rejects.toThrow('payment failed');
  });
});
