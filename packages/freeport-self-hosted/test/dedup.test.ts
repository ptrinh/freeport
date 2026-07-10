import { describe, it, expect } from 'vitest';
import type { Event } from 'nostr-tools';
import { latestByAddress } from '../src/tools.js';

function ev(kind: number, pubkey: string, d: string, created_at: number, id: string): Event {
  return { kind, pubkey, created_at, id, tags: [['d', d]], content: '', sig: '' } as Event;
}

describe('latestByAddress', () => {
  it('keeps only the newest version per (kind, pubkey, d)', () => {
    const out = latestByAddress([
      ev(32101, 'a', 'ride-1', 100, 'old'),
      ev(32101, 'a', 'ride-1', 200, 'new'),
      ev(32101, 'b', 'ride-1', 150, 'other-author'),
      ev(32102, 'a', 'ride-1', 150, 'other-kind'),
    ]);
    expect(out.map((e) => e.id).sort()).toEqual(['new', 'other-author', 'other-kind']);
  });

  it('passes distinct d tags through untouched', () => {
    const out = latestByAddress([
      ev(32104, 'a', 'deal-1', 100, 'r1'),
      ev(32104, 'a', 'deal-2', 100, 'r2'),
    ]);
    expect(out).toHaveLength(2);
  });
});
