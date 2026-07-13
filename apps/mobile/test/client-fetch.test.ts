import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same native-module stubs as the other client tests.
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
// Reputation fetches resolve under our control so concurrency is observable.
let pendingReps: Array<() => void> = [];
vi.mock('../src/reputation', () => ({
  fetchReputation: vi.fn(
    () => new Promise((resolve) => pendingReps.push(() => resolve({ score: 1 }))),
  ),
}));
vi.mock('../src/wot', () => ({
  buildTrustMap: vi.fn(async () => new Map()),
}));

import { MobileClient } from '../src/client';

const ME = 'f'.repeat(64);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);

function makeClient() {
  const reqs: any[] = [];
  let handlers: any = null;
  const client = new MobileClient({ pubkey: ME } as any, ['wss://relay.example']);
  (client as any).pool = {
    subscribeMany: (_relays: string[], filter: any, h: any) => {
      reqs.push(filter);
      handlers = h;
      return { close: () => {} };
    },
    publish: () => [Promise.resolve('ok')],
    ensureRelay: async () => {},
    listConnectionStatus: () => new Map(),
  };
  return { client, reqs, deliver: (ev: any) => handlers?.onevent(ev), eose: () => handlers?.oneose?.() };
}

describe('batched profile fetches', () => {
  beforeEach(() => { vi.useFakeTimers(); pendingReps = []; });

  it('coalesces a burst of unknown authors into ONE authors:[...] REQ', async () => {
    const { client, reqs } = makeClient();
    (client as any).fetchProfile(A);
    (client as any).fetchProfile(B);
    (client as any).fetchProfile(C);
    (client as any).fetchProfile(A); // duplicate — already marked in-flight
    expect(reqs).toHaveLength(0); // nothing sent yet — collecting
    vi.advanceTimersByTime(500);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].kinds).toEqual([0]);
    expect([...reqs[0].authors].sort()).toEqual([A, B, C]);
    vi.useRealTimers();
  });

  it('applies only the NEWEST kind-0 per author regardless of arrival order', async () => {
    const { client, reqs, deliver } = makeClient();
    (client as any).fetchProfile(A);
    vi.advanceTimersByTime(500);
    expect(reqs).toHaveLength(1);
    deliver({ kind: 0, pubkey: A, created_at: 200, content: JSON.stringify({ name: 'new' }) });
    deliver({ kind: 0, pubkey: A, created_at: 100, content: JSON.stringify({ name: 'stale' }) });
    expect(client.profiles.get(A)?.name).toBe('new');
    vi.useRealTimers();
  });
});

describe('reputation concurrency gate', () => {
  beforeEach(() => { vi.useRealTimers(); pendingReps = []; });

  it('runs at most 3 fetches at once and drains the queue as they finish', async () => {
    const { client } = makeClient();
    for (const pk of [A, B, C, D]) client.fetchReputation(pk);
    await new Promise((r) => setTimeout(r, 0)); // let trust() resolve
    expect(pendingReps).toHaveLength(3); // 4th is waiting
    pendingReps.shift()!(); // finish one
    await new Promise((r) => setTimeout(r, 0));
    expect(pendingReps).toHaveLength(3); // the 4th started
    for (const done of pendingReps.splice(0)) done();
    await new Promise((r) => setTimeout(r, 0));
    expect(client.reputations.size).toBe(4);
  });
});

describe('DM backfill window (dmLastSeen)', () => {
  beforeEach(() => { vi.useRealTimers(); kvStore.clear(); pendingReps = []; });

  it('backfills 7 days on first launch, and from lastSeen - margin afterwards', async () => {
    const now = Math.floor(Date.now() / 1000);
    // First launch: no stored lastSeen → full 7-day window.
    const first = makeClient();
    await first.client.loadNegotiations();
    first.client.watchDMs();
    // watchDMs subscribes with a filter ARRAY (kind-4 DMs + kind-1059 wraps).
    const dmFilter = (r: any) => (Array.isArray(r) ? r.find((f: any) => f.kinds?.includes(4)) : r);
    expect(dmFilter(first.reqs.at(-1)).since).toBeLessThanOrEqual(now - 7 * 24 * 3600 + 5);

    // A DM arrives 1h ago → lastSeen persists (via the debounced write).
    first.deliver({ kind: 4, pubkey: A, created_at: now - 3600, content: 'x', id: 'ev1', tags: [] });
    await new Promise((r) => setTimeout(r, 400)); // debounce is 250ms
    expect(Number(kvStore.get('freeport.dmLastSeen'))).toBe(now - 3600);

    // Next launch: window starts at lastSeen - 24h margin, not 7 days back.
    const second = makeClient();
    await second.client.loadNegotiations();
    second.client.watchDMs();
    const since = dmFilter(second.reqs.at(-1)).since;
    expect(since).toBeGreaterThan(now - 2 * 24 * 3600); // way inside 7d
    expect(since).toBeLessThanOrEqual(now - 3600 - 24 * 3600 + 5); // behind lastSeen by the margin
  });

  it('ignores far-future created_at when tracking lastSeen', async () => {
    const now = Math.floor(Date.now() / 1000);
    const { client, deliver } = makeClient();
    await client.loadNegotiations();
    client.watchDMs();
    deliver({ kind: 4, pubkey: A, created_at: now + 9999999, content: 'x', id: 'evF', tags: [] });
    await new Promise((r) => setTimeout(r, 400));
    expect(kvStore.get('freeport.dmLastSeen')).toBeUndefined();
  });
});
