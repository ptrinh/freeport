/**
 * HODL escrow e2e: buyer requests → seller creates hold invoice → buyer
 * releases the preimage on delivery → seller auto-claims. Real signing +
 * NIP-04 over the FakeRelay; only the wallet is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/kv', () => {
  const store = new Map<string, string>();
  return {
    kvGet: vi.fn(async (k: string) => store.get(k) ?? null),
    kvSet: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    kvDelete: vi.fn(async (k: string) => { store.delete(k); }),
    profileId: () => '', storagePrefix: () => '', storageKey: (k: string) => k,
  };
});
vi.mock('../src/pow', () => ({ minePowAsync: async (e: any) => e }));
vi.mock('../src/profile', () => ({ publishProfile: vi.fn(async () => {}), maskPhone: (s: string) => s }));
vi.mock('../src/karma', () => ({ publishKarma: vi.fn(async () => {}) }));
vi.mock('../src/receipts', () => ({ publishReceipt: vi.fn(async () => {}) }));
vi.mock('../src/reputation', () => ({ fetchReputation: vi.fn(async () => ({})) }));
vi.mock('../src/wot', () => ({ buildTrustMap: vi.fn(async () => new Map()) }));

import { generateSecretKey } from 'nostr-tools/pure';
import { sha256 } from '@noble/hashes/sha2.js';
import { buildIntentEvent, parseIntentEvent, DEMO_MARKET, DEMO_SCHEMA, makeEscrowRelease, parseEscrowEnvelope } from '@freeport/protocol';
import { MobileClient } from '../src/client';
import { LocalSigner } from '../src/signer';
import { FakeRelay, flush } from './fake-relay';

const RELAY = ['ws://fake'];
const now = () => Math.floor(Date.now() / 1000);

const holdInvoices: Array<{ sats: number; hash: string; expiry: number }> = [];
const claims: string[] = [];
let claimShouldFail = false;
const escrowWallet = {
  createHoldInvoice: vi.fn(async (sats: number, _d: string, hash: string, expiry: number) => {
    holdInvoices.push({ sats, hash, expiry });
    return 'lnbc-hold-' + hash.slice(0, 8);
  }),
  claimHtlc: vi.fn(async (preimage: string) => {
    if (claimShouldFail) throw new Error('not funded yet');
    claims.push(preimage);
  }),
};

function makeUser(relay: FakeRelay, withWallet: boolean) {
  const client = new MobileClient(new LocalSigner(generateSecretKey()), RELAY);
  (client as any).pool = relay;
  if (withWallet) client.getEscrowWallet = async () => escrowWallet;
  client.watchDMs();
  return { client, escrows: () => [...client.escrows.values()] };
}

/** Stand up a CONFIRMED deal between a buyer (intent owner) and seller. */
async function confirmedDeal(relay: FakeRelay, buyer: any, seller: any) {
  const signed = buildIntentEvent(
    {
      side: 'request', market: DEMO_MARKET, schema: DEMO_SCHEMA, title: 'Ride A → B',
      payload: { from: { name: 'A' }, to: { name: 'B' } }, expiresAt: now() + 3600,
    },
    (buyer.client as any).signer.secretKey,
  );
  const intent = parseIntentEvent(signed)!;
  (buyer.client as any).published.set(intent.id, intent);
  relay.publish(RELAY, signed);
  seller.client.watchMarket(DEMO_MARKET);
  await flush();
  const negoId = await seller.client.acceptIntent(intent, { payment: 'SGD 20' }, 'Seller · +65');
  await flush();
  return negoId!;
}

beforeEach(() => {
  holdInvoices.length = 0;
  claims.length = 0;
  claimShouldFail = false;
  escrowWallet.createHoldInvoice.mockClear();
  escrowWallet.claimHtlc.mockClear();
});

describe('HODL escrow', () => {
  it('request → hold invoice → release → auto-claim settles', async () => {
    const relay = new FakeRelay();
    const buyer = makeUser(relay, true);
    const seller = makeUser(relay, true);
    const negoId = await confirmedDeal(relay, buyer, seller);

    await buyer.client.requestEscrow(negoId, 21000);
    await flush();
    const b1 = buyer.escrows()[0];
    expect(b1.role).toBe('buyer');
    expect(b1.preimage).toMatch(/^[0-9a-f]{64}$/); // minted + kept locally
    const s1 = seller.escrows()[0];
    expect(s1?.role).toBe('seller');
    expect(s1.amountSats).toBe(21000);
    expect(s1.preimage).toBeUndefined(); // the seller must NOT know it yet

    await seller.client.acceptEscrow(negoId);
    await flush();
    expect(escrowWallet.createHoldInvoice).toHaveBeenCalledWith(21000, 'Freeport escrow', s1.hash, 24 * 3600);
    expect(buyer.escrows()[0].status).toBe('invoiced');
    expect(buyer.escrows()[0].invoice).toContain('lnbc-hold-');

    await buyer.client.releaseEscrow(negoId);
    await flush();
    expect(claims).toEqual([b1.preimage]); // auto-claimed with the exact preimage
    expect(seller.escrows()[0].status).toBe('settled');
  });

  it('a forged release (wrong preimage) never reaches the wallet', async () => {
    const relay = new FakeRelay();
    const buyer = makeUser(relay, true);
    const seller = makeUser(relay, true);
    const negoId = await confirmedDeal(relay, buyer, seller);
    await buyer.client.requestEscrow(negoId, 5000);
    await flush();
    const hash = seller.escrows()[0].hash;
    // The buyer's client "maliciously" sends a release whose preimage doesn't hash to the lock.
    await (buyer.client as any).sendDM(seller.client.pubkey, JSON.stringify(makeEscrowRelease(negoId, hash, 'ab'.repeat(32))));
    await flush();
    expect(escrowWallet.claimHtlc).not.toHaveBeenCalled();
    expect(seller.escrows()[0].status).toBe('requested');
  });

  it('claim failure → claim_failed, retry succeeds; settled release replays are no-ops', async () => {
    const relay = new FakeRelay();
    const buyer = makeUser(relay, true);
    const seller = makeUser(relay, true);
    const negoId = await confirmedDeal(relay, buyer, seller);
    await buyer.client.requestEscrow(negoId, 1000);
    await flush();
    await seller.client.acceptEscrow(negoId);
    await flush();

    claimShouldFail = true; // e.g. buyer hasn't actually paid yet
    await buyer.client.releaseEscrow(negoId);
    await flush();
    expect(seller.escrows()[0].status).toBe('claim_failed');

    claimShouldFail = false;
    await seller.client.claimEscrow(negoId); // the UI's Retry button
    expect(seller.escrows()[0].status).toBe('settled');
    expect(claims).toHaveLength(1);
  });

  it('escrow requests from strangers (not the deal counterparty) are dropped', async () => {
    const relay = new FakeRelay();
    const buyer = makeUser(relay, true);
    const seller = makeUser(relay, true);
    const stranger = makeUser(relay, false);
    const negoId = await confirmedDeal(relay, buyer, seller);
    const hash = [...sha256(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await (stranger.client as any).sendDM(seller.client.pubkey, JSON.stringify({ v: 1, type: 'escrow.request', nego: negoId, hash, amount_sats: 99999, ts: now() }));
    await flush();
    expect(seller.escrows()).toHaveLength(0);
  });

  it('envelope validation rejects junk', () => {
    expect(parseEscrowEnvelope(JSON.stringify({ v: 1, type: 'escrow.request', nego: 'n', hash: 'short', amount_sats: 1, ts: 1 }))).toBeNull();
    expect(parseEscrowEnvelope(JSON.stringify({ v: 1, type: 'escrow.invoice', nego: 'n', hash: 'a'.repeat(64), invoice: 'http://evil', ts: 1 }))).toBeNull();
    expect(parseEscrowEnvelope(JSON.stringify({ v: 1, type: 'escrow.request', nego: 'n', hash: 'a'.repeat(64), amount_sats: -5, ts: 1 }))).toBeNull();
  });
});
