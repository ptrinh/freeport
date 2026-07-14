/** NIP-57 zaps: request building, invoice fetch, receipt-total parsing. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateSecretKey, finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { zapInvoice, receiptSats, fetchZapTotals, resolveLnurlPay } from '../src/zaps';
import { LocalSigner } from '../src/signer';
import { FakeRelay, flush } from './fake-relay';

const sk = generateSecretKey();
const signer = new LocalSigner(sk);
const RECEIVER = 'a'.repeat(64);

afterEach(() => vi.unstubAllGlobals());

function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    json: async () => {
      for (const [prefix, body] of Object.entries(routes)) {
        if (String(url).startsWith(prefix)) return typeof body === 'function' ? (body as any)(url) : body;
      }
      throw new Error('unrouted ' + url);
    },
  })));
}

describe('zapInvoice', () => {
  const LNURLP = {
    tag: 'payRequest', callback: 'https://pay.example/cb',
    minSendable: 1000, maxSendable: 100_000_000,
    allowsNostr: true, nostrPubkey: 'b'.repeat(64),
  };

  it('builds a signed 9734 request and returns the invoice', async () => {
    let nostrParam: any = null;
    stubFetch({
      'https://example.com/.well-known/lnurlp/alice': LNURLP,
      'https://pay.example/cb': (url: string) => {
        nostrParam = JSON.parse(decodeURIComponent(new URL(url).searchParams.get('nostr')!));
        return { pr: 'lnbc210n1p0test' }; // 210n = 21 sat, matches the request
      },
    });
    const res = await zapInvoice(signer, { lud16: 'alice@example.com', toPubkey: RECEIVER, eventId: 'evt1', amountSat: 21, relays: ['wss://r'] });
    expect(res).toEqual({ pr: 'lnbc210n1p0test', zap: true });
    expect(nostrParam.kind).toBe(9734);
    expect(nostrParam.pubkey).toBe(getPublicKey(sk));
    expect(nostrParam.tags).toContainEqual(['amount', '21000']);
    expect(nostrParam.tags).toContainEqual(['p', RECEIVER]);
    expect(nostrParam.tags).toContainEqual(['e', 'evt1']);
  });

  it('degrades to a plain lnurl-pay tip when the server lacks zap support', async () => {
    stubFetch({
      'https://example.com/.well-known/lnurlp/bob': { ...LNURLP, allowsNostr: undefined, nostrPubkey: undefined },
      'https://pay.example/cb': (url: string) => {
        expect(new URL(url).searchParams.get('nostr')).toBeNull();
        return { pr: 'lnbc210n1p0test' }; // 210n = 21 sat, matches
      },
    });
    const res = await zapInvoice(signer, { lud16: 'bob@example.com', toPubkey: RECEIVER, amountSat: 21, relays: [] });
    expect(res).toEqual({ pr: 'lnbc210n1p0test', zap: false });
  });

  it('rejects an amountless / unparseable invoice (hostile amount-omission)', async () => {
    stubFetch({
      'https://example.com/.well-known/lnurlp/alice': LNURLP,
      'https://pay.example/cb': { pr: 'lnbc1p0noamount' }, // no amount in the HRP
    });
    const res = await zapInvoice(signer, { lud16: 'alice@example.com', toPubkey: RECEIVER, amountSat: 250, relays: ['wss://r'] });
    expect(res).toBeNull();
  });

  it('refuses a non-https callback (no http downgrade / MITM)', async () => {
    stubFetch({
      'https://example.com/.well-known/lnurlp/alice': { ...LNURLP, callback: 'http://pay.example/cb' },
      'http://pay.example/cb': { pr: 'lnbc2500n1p0xyzabc' },
    });
    const res = await zapInvoice(signer, { lud16: 'alice@example.com', toPubkey: RECEIVER, amountSat: 250, relays: ['wss://r'] });
    expect(res).toBeNull();
  });

  it('rejects out-of-range amounts and unresolvable addresses', async () => {
    stubFetch({ 'https://example.com/.well-known/lnurlp/alice': LNURLP });
    expect(await zapInvoice(signer, { lud16: 'alice@example.com', toPubkey: RECEIVER, amountSat: 0.5, relays: [] })).toBeNull();
    expect(await resolveLnurlPay('not-an-address')).toBeNull();
  });

  it('rejects an invoice that bills more than requested (malicious LNURL)', async () => {
    stubFetch({
      'https://example.com/.well-known/lnurlp/alice': LNURLP,
      'https://pay.example/cb': { pr: 'lnbc10u1p0xyzabc' }, // 1000 sat — we asked 250
    });
    const res = await zapInvoice(signer, { lud16: 'alice@example.com', toPubkey: RECEIVER, amountSat: 250, relays: ['wss://r'] });
    expect(res).toBeNull();
  });

  it('accepts an invoice whose amount matches the request', async () => {
    stubFetch({
      'https://example.com/.well-known/lnurlp/alice': LNURLP,
      'https://pay.example/cb': { pr: 'lnbc2500n1p0xyzabc' }, // 250 sat
    });
    const res = await zapInvoice(signer, { lud16: 'alice@example.com', toPubkey: RECEIVER, amountSat: 250, relays: ['wss://r'] });
    expect(res?.pr).toBe('lnbc2500n1p0xyzabc');
  });
});

describe('zap receipts', () => {
  function receipt(target: string, sats: number) {
    const req = { kind: 9734, tags: [['amount', String(sats * 1000)], ['e', target]] };
    return finalizeEvent({
      kind: 9735,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['e', target], ['p', RECEIVER], ['description', JSON.stringify(req)]],
      content: '',
    }, generateSecretKey());
  }

  it('receiptSats reads the amount from the embedded 9734', () => {
    expect(receiptSats(receipt('x', 210))).toBe(210);
    expect(receiptSats({ tags: [], content: '' } as any)).toBe(0);
  });

  it('fetchZapTotals sums per post over the relay', async () => {
    const relay = new FakeRelay();
    relay.publish(['ws://fake'], receipt('post1', 21));
    relay.publish(['ws://fake'], receipt('post1', 100));
    relay.publish(['ws://fake'], receipt('post2', 5));
    const totals = await new Promise<Map<string, number>>((resolve) => {
      fetchZapTotals(relay as any, ['ws://fake'], ['post1', 'post2'], resolve);
    });
    await flush();
    expect(totals.get('post1')).toBe(121);
    expect(totals.get('post2')).toBe(5);
  });
});
