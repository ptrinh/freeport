import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same native-module stubs as client-block.test.ts — client.ts reaches
// RN/Expo-coupled modules at import time.
const kvStore = new Map<string, string>();
vi.mock('../src/kv', () => ({
  kvGet: vi.fn(async (k: string) => kvStore.get(k) ?? null),
  kvSet: vi.fn(async (k: string, v: string) => { kvStore.set(k, v); }),
  kvDelete: vi.fn(async (k: string) => { kvStore.delete(k); }),
  profileId: () => '',
  storagePrefix: () => '',
  storageKey: (k: string) => k,
}));
vi.mock('../src/profile', () => ({
  publishProfile: vi.fn(async () => {}),
  maskPhone: (s: string) => s,
}));
vi.mock('../src/karma', () => ({
  publishKarma: vi.fn(async () => {}),
}));

import { MobileClient } from '../src/client';

const ME = 'f'.repeat(64);
const PEER = 'a'.repeat(64);

function makeClient(publishOk: () => boolean): { client: MobileClient; published: any[] } {
  const published: any[] = [];
  const signer = {
    pubkey: ME,
    nip04Encrypt: vi.fn(async (_to: string, plain: string) => `enc:${plain}`),
    signEvent: vi.fn(async (tmpl: any) => ({ ...tmpl, id: `ev-${published.length}-${Math.random()}`, pubkey: ME, sig: 'sig' })),
  } as any;
  const client = new MobileClient(signer, ['wss://relay.example']);
  // Stub the pool: publish resolves or rejects depending on publishOk().
  (client as any).pool = {
    publish: (_relays: string[], ev: any) => [
      publishOk()
        ? (published.push(ev), Promise.resolve('ok'))
        : Promise.reject(new Error('relay down')),
    ],
    ensureRelay: async () => {},
    listConnectionStatus: () => new Map(),
  };
  return { client, published };
}

describe('MobileClient DM outbox', () => {
  beforeEach(() => kvStore.clear());

  it('queues an undeliverable DM instead of rejecting, then flushes on reconnect', async () => {
    let online = false;
    const { client, published } = makeClient(() => online);
    const counts: number[] = [];
    client.onOutboxChange = (n) => counts.push(n);

    // Offline send: must not throw, must queue + persist.
    await expect((client as any).sendDM(PEER, '{"hello":1}')).resolves.toBe(false);
    expect(client.outboxPending()).toBe(1);
    expect(counts.at(-1)).toBe(1);
    expect(published).toHaveLength(0);
    // allow the fire-and-forget persist to land
    await new Promise((r) => setTimeout(r, 0));
    expect(kvStore.get('freeport.outbox')).toContain('enc:');

    // Back online: reconnect flushes the queue.
    online = true;
    await client.reconnect();
    await new Promise((r) => setTimeout(r, 0));
    expect(client.outboxPending()).toBe(0);
    expect(published).toHaveLength(1);
    expect(counts.at(-1)).toBe(0);
  });

  it('rehydrates a persisted outbox on load and drops stale entries', async () => {
    const now = Math.floor(Date.now() / 1000);
    kvStore.set('freeport.outbox', JSON.stringify([
      { event: { id: 'fresh', kind: 4, created_at: now - 60, tags: [['p', PEER]], content: 'enc:x', pubkey: ME, sig: 's' } },
      { event: { id: 'stale', kind: 4, created_at: now - 8 * 24 * 3600, tags: [['p', PEER]], content: 'enc:y', pubkey: ME, sig: 's' } },
    ]));
    const { client, published } = makeClient(() => true);
    await client.loadNegotiations();
    await new Promise((r) => setTimeout(r, 0));
    // Fresh entry delivered, stale entry dropped, queue empty.
    expect(published.map((e) => e.id)).toEqual(['fresh']);
    expect(client.outboxPending()).toBe(0);
  });

  it('a failed flush re-queues rather than losing the DM', async () => {
    const { client, published } = makeClient(() => false);
    await (client as any).sendDM(PEER, '{"a":1}');
    await client.flushOutbox();
    expect(client.outboxPending()).toBe(1);
    expect(published).toHaveLength(0);
  });
});
