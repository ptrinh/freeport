import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools';
import { RelayCore } from '../src/relay.js';

const NOW = 1_800_000_000;
const sk = generateSecretKey();
const pk = getPublicKey(sk);

function sign(over: Partial<Event> & { kind: number }): Event {
  return finalizeEvent(
    { kind: over.kind, created_at: over.created_at ?? NOW, tags: over.tags ?? [], content: over.content ?? '' },
    sk,
  ) as Event;
}

/** A RelayCore + one connection whose sent messages are captured. */
function harness(now = () => NOW) {
  const core = new RelayCore(50_000, now);
  const out: unknown[][] = [];
  core.connect('c1', (m) => out.push(m));
  return { core, out, sent: (cmd: string) => out.filter((m) => m[0] === cmd) };
}

describe('RelayCore (embedded NIP-01 relay)', () => {
  it('accepts a valid event and replies OK true', () => {
    const { core, sent } = harness();
    const ev = sign({ kind: 1, content: 'hi' });
    core.handle('c1', JSON.stringify(['EVENT', ev]));
    expect(sent('OK')[0]).toEqual(['OK', ev.id, true, '']);
    expect(core.size()).toBe(1);
  });

  it('rejects a tampered (bad-signature) event', () => {
    const { core, sent } = harness();
    const ev = { ...sign({ kind: 1, content: 'real' }), content: 'tampered' } as Event;
    core.handle('c1', JSON.stringify(['EVENT', ev]));
    expect(sent('OK')[0][2]).toBe(false);
    expect(core.size()).toBe(0);
  });

  it('REQ returns stored matches then EOSE', () => {
    const { core, out, sent } = harness();
    const a = sign({ kind: 1, content: 'a' });
    const b = sign({ kind: 7, content: 'b' });
    core.handle('c1', JSON.stringify(['EVENT', a]));
    core.handle('c1', JSON.stringify(['EVENT', b]));
    out.length = 0;
    core.handle('c1', JSON.stringify(['REQ', 's1', { kinds: [1] }]));
    const evts = sent('EVENT');
    expect(evts).toHaveLength(1);
    expect((evts[0][2] as Event).id).toBe(a.id);
    expect(out.at(-1)).toEqual(['EOSE', 's1']);
  });

  it('live-broadcasts a new event to a matching open subscription', () => {
    const { core, out, sent } = harness();
    core.handle('c1', JSON.stringify(['REQ', 's1', { kinds: [1] }]));
    out.length = 0;
    const ev = sign({ kind: 1, content: 'live' });
    core.handle('c1', JSON.stringify(['EVENT', ev]));
    const pushed = sent('EVENT').find((m) => m[1] === 's1');
    expect(pushed).toBeTruthy();
    expect((pushed![2] as Event).id).toBe(ev.id);
  });

  it('CLOSE stops further delivery to that subscription', () => {
    const { core, out, sent } = harness();
    core.handle('c1', JSON.stringify(['REQ', 's1', { kinds: [1] }]));
    core.handle('c1', JSON.stringify(['CLOSE', 's1']));
    out.length = 0;
    core.handle('c1', JSON.stringify(['EVENT', sign({ kind: 1 })]));
    expect(sent('EVENT')).toHaveLength(0);
  });

  it('addressable event (32101) is replaced by a newer version, not duplicated', () => {
    const { core } = harness();
    const older = sign({ kind: 32101, created_at: NOW, tags: [['d', 'ride-1']], content: 'v1' });
    const newer = sign({ kind: 32101, created_at: NOW + 10, tags: [['d', 'ride-1']], content: 'v2' });
    core.handle('c1', JSON.stringify(['EVENT', older]));
    core.handle('c1', JSON.stringify(['EVENT', newer]));
    expect(core.size()).toBe(1);
    const out: unknown[][] = [];
    core.connect('q', (m) => out.push(m));
    core.handle('q', JSON.stringify(['REQ', 's', { kinds: [32101] }]));
    const got = out.find((m) => m[0] === 'EVENT');
    expect((got![2] as Event).content).toBe('v2');
  });

  it('rejects an expired (NIP-40) event', () => {
    const { core, sent } = harness(() => NOW);
    const ev = sign({ kind: 1, tags: [['expiration', String(NOW - 1)]] });
    core.handle('c1', JSON.stringify(['EVENT', ev]));
    expect(sent('OK')[0][2]).toBe(false);
    expect(sent('OK')[0][3]).toContain('expired');
    expect(core.size()).toBe(0);
  });

  it('prune() drops events whose expiration has passed', () => {
    let clock = NOW;
    const { core } = harness(() => clock);
    core.handle('c1', JSON.stringify(['EVENT', sign({ kind: 1, tags: [['expiration', String(NOW + 100)]] })]));
    expect(core.size()).toBe(1);
    clock = NOW + 200;
    core.prune();
    expect(core.size()).toBe(0);
  });

  it('duplicate event id is acknowledged but not stored twice', () => {
    const { core } = harness();
    const ev = sign({ kind: 1, content: 'dup' });
    core.handle('c1', JSON.stringify(['EVENT', ev]));
    core.handle('c1', JSON.stringify(['EVENT', ev]));
    expect(core.size()).toBe(1);
  });

  it('invalid JSON → NOTICE, never throws', () => {
    const { core, sent } = harness();
    expect(() => core.handle('c1', '{not json')).not.toThrow();
    expect(sent('NOTICE')).toHaveLength(1);
  });
});
