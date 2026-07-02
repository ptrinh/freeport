import { describe, it, expect, vi } from 'vitest';

// livetrip pulls in maps → expo modules on import; stub what it touches.
vi.mock('../src/kv', () => ({
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => {}),
  kvDelete: vi.fn(async () => {}),
  profileId: () => '',
  storagePrefix: () => '',
  storageKey: (k: string) => k,
}));

import { createTripSession, decodeTripHash, tripLink, subscribeTrip } from '../src/livetrip';
import * as nip04 from 'nostr-tools/nip04';

describe('subscribeTrip ordering', () => {
  it('drops out-of-order updates and never resurrects an ended trip', async () => {
    const sess = createTripSession({ from: 'A', to: 'B' } as any);
    const view = decodeTripHash(new URL(tripLink(sess, 'https://x.example')).hash)!;
    expect(view).toBeTruthy();

    let handler: any = null;
    const pool: any = {
      subscribeMany: (_r: string[], _f: any, h: any) => { handler = h; return { close: () => {} }; },
    };
    const seen: any[] = [];
    subscribeTrip(pool, view, (u) => seen.push(u));

    const enc = async (u: any) => ({
      content: await nip04.encrypt(sess.sk, sess.pk, JSON.stringify(u)),
    });

    await handler.onevent(await enc({ lat: 1, lon: 1, ts: 100, status: 'live' }));
    await handler.onevent(await enc({ lat: 2, lon: 2, ts: 300, status: 'live' }));
    // Stale position delivered late by a lagging relay — must be dropped.
    await handler.onevent(await enc({ lat: 9, lon: 9, ts: 200, status: 'live' }));
    // Ended, then a replayed old 'live' — the trip must stay ended.
    await handler.onevent(await enc({ lat: 2, lon: 2, ts: 400, status: 'ended' }));
    await handler.onevent(await enc({ lat: 1, lon: 1, ts: 150, status: 'live' }));

    expect(seen.map((u) => u.ts)).toEqual([100, 300, 400]);
    expect(seen.at(-1).status).toBe('ended');
  });
});
