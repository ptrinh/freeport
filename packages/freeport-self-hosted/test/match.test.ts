import { describe, it, expect } from 'vitest';
import { geohashEncode, KIND_INTENT_OFFER } from '@freeport/protocol';
import { matches, DEFAULT_KINDS, unionKinds } from '../src/notify/match.js';

// Minimal Nostr-event shape for the matcher (only kind + tags are read here).
const ev = (over: Record<string, unknown> = {}): any => ({
  kind: KIND_INTENT_OFFER, tags: [], content: '', id: 'x', pubkey: 'p', created_at: 0, sig: '', ...over,
});

describe('matches()', () => {
  // Regression: an empty filter is a DM-only subscriber (Browse alerts off). It
  // must NOT fire for every intent on the network. (commit 418e1ad / match.ts)
  it('empty filter never matches an intent', () => {
    expect(matches(ev(), {})).toBe(false);
    expect(matches(ev({ tags: [['t', 'sg_ridesharing']] }), {})).toBe(false);
  });

  it('matches only when a topic tag overlaps the filter', () => {
    const e = ev({ tags: [['t', 'sg_ridesharing']] });
    expect(matches(e, { topics: ['sg_ridesharing'] })).toBe(true);
    expect(matches(e, { topics: ['vn_homeservices'] })).toBe(false);
  });

  it('rejects a kind the subscriber did not ask for', () => {
    expect(matches(ev({ kind: 1, tags: [['t', 'sg']] }), { topics: ['sg'] })).toBe(false);
  });

  it('geohash radius: a nearby post passes, a far one fails', () => {
    const near = geohashEncode(1.3008, 103.8427, 8); // Singapore
    const far = geohashEncode(21.0278, 105.8342, 8); // Hanoi (~3,000 km away)
    const f = { near: { lat: 1.3008, lon: 103.8427, radiusKm: 5 } };
    expect(matches(ev({ tags: [['g', near]] }), f)).toBe(true);
    expect(matches(ev({ tags: [['g', far]] }), f)).toBe(false);
  });

  it('a near-filter with no geohash on the event does not match', () => {
    expect(matches(ev({ tags: [] }), { near: { lat: 1, lon: 1, radiusKm: 5 } })).toBe(false);
  });
});

describe('unionKinds()', () => {
  it('falls back to the default intent kinds when none are specified', () => {
    expect(unionKinds([{}]).sort()).toEqual([...DEFAULT_KINDS].sort());
  });
  it('unions explicit kinds across filters', () => {
    expect(unionKinds([{ kinds: [4] }, { kinds: [4, 7] }]).sort()).toEqual([4, 7]);
  });
});
