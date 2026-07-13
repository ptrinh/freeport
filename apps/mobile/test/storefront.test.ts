/** NIP-15 storefronts: publish/edit/remove products + browse over the fake relay. */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/kv', () => ({
  kvGet: vi.fn(async () => null), kvSet: vi.fn(async () => {}), kvDelete: vi.fn(async () => {}),
  profileId: () => '', storagePrefix: () => '', storageKey: (k: string) => k,
}));
vi.mock('../src/pow', () => ({ minePowAsync: async (e: any) => e }));
vi.mock('../src/profile', () => ({ publishProfile: vi.fn(async () => {}), maskPhone: (s: string) => s }));
vi.mock('../src/karma', () => ({ publishKarma: vi.fn(async () => {}) }));
vi.mock('../src/receipts', () => ({ publishReceipt: vi.fn(async () => {}) }));
vi.mock('../src/reputation', () => ({ fetchReputation: vi.fn(async () => ({})) }));
vi.mock('../src/wot', () => ({ buildTrustMap: vi.fn(async () => new Map()) }));

import { generateSecretKey } from 'nostr-tools/pure';
import { mintProductId, parseProductEvent, buildProductTemplate, SERVICE_MARKET, type Product } from '@freeport/protocol';
import { MobileClient } from '../src/client';
import { LocalSigner } from '../src/signer';
import { FakeRelay, flush } from './fake-relay';

function makeUser(relay: FakeRelay) {
  const client = new MobileClient(new LocalSigner(generateSecretKey()), ['ws://fake']);
  (client as any).pool = relay;
  const events: Product[] = [];
  client.onProduct = (p) => events.push(p);
  client.watchShops(SERVICE_MARKET);
  return { client, events, products: () => [...client.products.values()] };
}

describe('product events', () => {
  it('builds and parses; rejects junk and tombstones', () => {
    const tmpl = buildProductTemplate({ d: 'p1', market: SERVICE_MARKET, name: 'Honey 500g', currency: 'SGD', price: 12 });
    const ev = { ...tmpl, id: 'e1', pubkey: 'a'.repeat(64) } as any;
    const parsed = parseProductEvent(ev);
    expect(parsed?.content.name).toBe('Honey 500g');
    expect(parsed?.d).toBe('p1');
    expect(parseProductEvent({ ...ev, content: '' })).toBeNull();          // tombstone
    expect(parseProductEvent({ ...ev, content: '{"name":"x"}' })).toBeNull(); // no price/currency
    expect(parseProductEvent({ ...ev, content: JSON.stringify({ name: 'x', price: -1, currency: 'USD' }) })).toBeNull();
  });

  it('mintProductId is 16-hex and unique', () => {
    expect(mintProductId()).toMatch(/^[0-9a-f]{16}$/);
    expect(mintProductId()).not.toBe(mintProductId());
  });
});

describe('shop lifecycle over the relay', () => {
  it('publish → seen by browsers; edit replaces; remove tombstones', async () => {
    const relay = new FakeRelay();
    const seller = makeUser(relay);
    const buyer = makeUser(relay);

    const product = await seller.client.publishProduct({ d: mintProductId(), market: SERVICE_MARKET, name: 'Sourdough', currency: 'SGD', price: 8 });
    await flush();
    expect(buyer.products()).toHaveLength(1);
    expect(buyer.products()[0].content.name).toBe('Sourdough');

    // Edit = republish the same d with new content (created_at must advance).
    await new Promise((r) => setTimeout(r, 1100));
    await seller.client.publishProduct({ d: product.d, market: SERVICE_MARKET, name: 'Sourdough (large)', currency: 'SGD', price: 12 });
    await flush();
    expect(buyer.products()).toHaveLength(1); // replaced, not duplicated
    expect(buyer.products()[0].content.price).toBe(12);

    // Remove → tombstone → gone from browsers.
    await new Promise((r) => setTimeout(r, 1100));
    await seller.client.removeProduct(product.d, SERVICE_MARKET);
    await flush();
    expect(buyer.products()).toHaveLength(0);
    expect(seller.products()).toHaveLength(0);
  }, 10_000);

  it('refuses prohibited listings', async () => {
    const relay = new FakeRelay();
    const seller = makeUser(relay);
    await expect(
      seller.client.publishProduct({ d: mintProductId(), market: SERVICE_MARKET, name: 'cocaine 1g', currency: 'USD', price: 50 }),
    ).rejects.toThrow();
  });
});
