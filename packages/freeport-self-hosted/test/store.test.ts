import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SubStore } from '../src/notify/store.js';

const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: 'k', auth: 'a' } });
const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'substore-')), 'subs.json');

describe('SubStore indexing', () => {
  it('routes DMs by pubkey, intents by topic, and no-topic subs catch every topic', () => {
    const s = new SubStore(tmpFile());
    s.upsertWeb(sub('https://push/1'), { topics: ['sg_ridesharing'] }, 'pub_a');
    s.upsertWeb(sub('https://push/2'), {}, 'pub_b'); // DM-only, no topic filter

    expect(s.subsForPubkeys(['pub_a']).length).toBe(1);
    expect(s.subsForPubkeys(['pub_b']).length).toBe(1);
    expect(s.subsForPubkeys(['nobody']).length).toBe(0);

    // The topic sub AND the no-topic catch-all are both intent candidates.
    expect(s.intentCandidates(['sg_ridesharing']).length).toBe(2);
    // An unrelated topic still surfaces only the no-topic sub.
    expect(s.intentCandidates(['vn_homeservices']).length).toBe(1);
  });

  it('upsert replaces in place by endpoint; remove clears the indexes', () => {
    const s = new SubStore(tmpFile());
    s.upsertWeb(sub('https://push/1'), { topics: ['a'] }, 'p');
    s.upsertWeb(sub('https://push/1'), { topics: ['b'] }, 'p'); // same endpoint -> update
    expect(s.size()).toBe(1);
    expect(s.intentCandidates(['a']).length).toBe(0);
    expect(s.intentCandidates(['b']).length).toBe(1);

    expect(s.removeByKey('https://push/1')).toBe(true);
    expect(s.size()).toBe(0);
    expect(s.removeByKey('https://push/1')).toBe(false);
  });
});

describe('SubStore.sweepStale (TTL backstop)', () => {
  // Regression: TTL sweep prunes subs that went stale without ever being pushed
  // to, keyed on lastSeenAt; records persisted before the field existed migrate
  // from createdAt on load. (commit 418e1ad)
  it('removes idle records, keeps fresh ones, and migrates a missing lastSeenAt', () => {
    const path = tmpFile();
    writeFileSync(path, JSON.stringify([
      { id: 'fresh', subscription: sub('https://push/fresh'), filters: { topics: ['x'] }, createdAt: 1000, lastSeenAt: Date.now() },
      { id: 'stale', subscription: sub('https://push/stale'), filters: { topics: ['x'] }, createdAt: 1000, lastSeenAt: 1000 },
      { id: 'legacy', subscription: sub('https://push/legacy'), filters: { topics: ['x'] }, createdAt: 1000 }, // no lastSeenAt
    ]));
    const s = new SubStore(path);
    expect(s.size()).toBe(3);

    const removed = s.sweepStale(365 * 24 * 3600 * 1000); // 1 year
    expect(removed).toBe(2); // stale + legacy (legacy migrated lastSeenAt = createdAt = ancient)
    expect(s.size()).toBe(1);
    expect(s.all()[0].id).toBe('fresh');
  });

  it('bumps lastSeenAt on every re-subscribe (heartbeat) so an active sub never ages out', () => {
    const s = new SubStore(tmpFile());
    const first = s.upsertWeb(sub('https://push/1'), { topics: ['x'] }, 'p').lastSeenAt;
    const second = s.upsertWeb(sub('https://push/1'), { topics: ['x'] }, 'p').lastSeenAt;
    expect(second).toBeGreaterThanOrEqual(first);
    expect(s.sweepStale(365 * 24 * 3600 * 1000)).toBe(0);
  });
});

describe('SubStore persistence', () => {
  it('round-trips records to disk and reloads them', async () => {
    const path = tmpFile();
    const s1 = new SubStore(path, 0); // 0ms debounce -> flush on next tick
    s1.upsertWeb(sub('https://push/1'), { topics: ['t'] }, 'p');
    await new Promise((r) => setTimeout(r, 30));
    expect(existsSync(path)).toBe(true);

    const s2 = new SubStore(path);
    expect(s2.size()).toBe(1);
    expect(s2.intentCandidates(['t']).length).toBe(1);
  });
});
