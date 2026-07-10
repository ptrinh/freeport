/**
 * Regression: a confirmed deal sat at "waiting for the other party to come
 * online" forever on the driver while the passenger was online and chatting
 * (field report). Root cause: one lost accept DM (signer hiccup while
 * backgrounding) + a persisted once-ever guard that burned the retry. The
 * healing predicates under test drive the App back-flow/poke effect.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
import { needsContactBackflow, shouldPokeForContact } from '../src/deals';

const NOW = 1_800_000_000;

describe('needsContactBackflow — send our contact when theirs arrived', () => {
  it('the passenger case: confirmed, has their contact, never sent ours', () => {
    expect(needsContactBackflow({ state: 'confirmed', theirContact: 'awadw · +66…', ourContact: undefined } as any)).toBe(true);
  });

  it('already sent ours → nothing to do (prevents re-send spam)', () => {
    expect(needsContactBackflow({ state: 'confirmed', theirContact: 'x', ourContact: 'me · +60…' } as any)).toBe(false);
  });

  it('not confirmed / no inbound contact yet → no back-flow', () => {
    expect(needsContactBackflow({ state: 'open', theirContact: 'x', ourContact: undefined } as any)).toBe(false);
    expect(needsContactBackflow({ state: 'confirmed', theirContact: undefined, ourContact: undefined } as any)).toBe(false);
  });
});

describe('shouldPokeForContact — waiting side re-sends its accept', () => {
  const stuck = { state: 'confirmed', ourContact: 'me · +60…', theirContact: undefined, updatedAt: NOW - 300 };

  it('the driver case: confirmed, sent ours, theirs missing, stuck > grace', () => {
    expect(shouldPokeForContact(stuck as any, NOW)).toBe(true);
  });

  it('within the grace window (normal seconds-long handshake) → no poke', () => {
    expect(shouldPokeForContact({ ...stuck, updatedAt: NOW - 10 } as any, NOW)).toBe(false);
  });

  it('mutual already (their contact present) → no poke', () => {
    expect(shouldPokeForContact({ ...stuck, theirContact: 'them' } as any, NOW)).toBe(false);
  });

  it('nothing sent from our side → back-flow case, not poke', () => {
    expect(shouldPokeForContact({ ...stuck, ourContact: undefined } as any, NOW)).toBe(false);
  });

  it('non-confirmed states never poke', () => {
    for (const state of ['open', 'cancelled', 'expired', 'accepted_by_them', 'cancel_requested']) {
      expect(shouldPokeForContact({ ...stuck, state } as any, NOW)).toBe(false);
    }
  });
});
