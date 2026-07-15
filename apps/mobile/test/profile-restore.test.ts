/**
 * Profile restore gap (user report): logout → login from an old backup file
 * restored Display Name and Phone but NOT the avatar — bundles written before
 * the user set a picture simply don't carry one. fillMissingProfileFromRelays
 * pulls what the network already knows (encrypted sync bundle first, public
 * kind:0 second) but ONLY into fields the restore left empty.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('../src/kv', () => ({
  kvGet: vi.fn(async (k: string) => store.get(k) ?? null),
  kvSet: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  kvDelete: vi.fn(async (k: string) => { store.delete(k); }),
  profileId: () => '', storagePrefix: () => '', storageKey: (k: string) => k,
}));
vi.mock('../src/cloudSync', () => ({ scheduleCloudSync: vi.fn() }));

// The pool's answers per test: keyed by which kind the filter asks for.
let relayEvents: { sync?: any; kind0?: any } = {};
const poolGet = vi.fn(async (_relays: string[], filter: any) => {
  if (filter.kinds?.includes(30078)) return relayEvents.sync ?? null;
  if (filter.kinds?.includes(0)) return relayEvents.kind0 ?? null;
  return null;
});
vi.mock('nostr-tools/pool', () => ({
  SimplePool: class { get = poolGet; close() {} publish() { return []; } },
}));

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { fillMissingProfileFromRelays } from '../src/relaySync';
import { loadProfile, saveProfile, type UserProfile } from '../src/profile';

const sk = generateSecretKey();
const selfKey = nip44.getConversationKey(sk, getPublicKey(sk));

const baseProfile = (over: Partial<UserProfile>): UserProfile => ({
  name: '', picture: '', about: '', gallery: [], phone: '', phoneDisplay: 'full',
  externalLink: '', link: '', vehicleModel: '', plateNumber: '', plateDisplay: 'masked', ...over,
});

const syncEventWith = (profile: Partial<UserProfile>) => ({
  content: nip44.encrypt(JSON.stringify({ v: 1, profile }), selfKey),
});

beforeEach(() => {
  store.clear();
  relayEvents = {};
  poolGet.mockClear();
});

describe('fillMissingProfileFromRelays', () => {
  it('fills the missing avatar from the sync bundle, keeps restored name/phone', async () => {
    // The old backup file had name+phone but predates the avatar.
    await saveProfile(baseProfile({ name: 'Phil', phone: '+6591234567' }));
    relayEvents.sync = syncEventWith({ name: 'Old Name', picture: 'https://img/avatar.jpg', about: 'hello' });

    await fillMissingProfileFromRelays(sk);
    const p = await loadProfile();
    expect(p.picture).toBe('https://img/avatar.jpg'); // filled
    expect(p.about).toBe('hello');                    // filled
    expect(p.name).toBe('Phil');                      // NOT clobbered by the relay copy
    expect(p.phone).toBe('+6591234567');              // untouched (relay never has it)
  });

  it('falls back to the public kind:0 when no sync bundle exists', async () => {
    await saveProfile(baseProfile({ phone: '+6591234567' }));
    relayEvents.kind0 = { content: JSON.stringify({ name: 'K0 Name', picture: 'https://img/k0.jpg', gallery: ['https://img/g1.jpg'] }) };

    await fillMissingProfileFromRelays(sk);
    const p = await loadProfile();
    expect(p.name).toBe('K0 Name');
    expect(p.picture).toBe('https://img/k0.jpg');
    expect(p.gallery).toEqual(['https://img/g1.jpg']);
  });

  it('leaves the local profile alone when the relays know nothing', async () => {
    await saveProfile(baseProfile({ name: 'Phil' }));
    await fillMissingProfileFromRelays(sk);
    const p = await loadProfile();
    expect(p.name).toBe('Phil');
    expect(p.picture).toBe('');
  });

  it('does not even hit the network when the restore was complete', async () => {
    await saveProfile(baseProfile({ name: 'P', picture: 'https://img/x.jpg', about: 'a', gallery: ['https://img/g.jpg'] }));
    await fillMissingProfileFromRelays(sk);
    expect(poolGet).not.toHaveBeenCalled();
  });

  it('a corrupt sync event falls through to kind:0 instead of throwing', async () => {
    await saveProfile(baseProfile({}));
    relayEvents.sync = { content: 'not-nip44-at-all' };
    relayEvents.kind0 = { content: JSON.stringify({ picture: 'https://img/k0.jpg' }) };
    await fillMissingProfileFromRelays(sk);
    expect((await loadProfile()).picture).toBe('https://img/k0.jpg');
  });
});
