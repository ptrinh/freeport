/**
 * Group import (member side): join-flow pref configuration, local membership
 * recording, and same-group badge matching.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// prefs.ts persists through kv + cloudSync — both native-only, so stub them.
vi.mock('../src/kv', () => {
  const store = new Map<string, string>();
  return {
    kvGet: vi.fn(async (k: string) => store.get(k) ?? null),
    kvSet: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    kvDelete: vi.fn(async (k: string) => { store.delete(k); }),
    __store: store,
  };
});
vi.mock('../src/cloudSync', () => ({ scheduleCloudSync: vi.fn() }));

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import {
  makeGroupDescriptor,
  verifyGroupEvent,
  matchSameGroup,
  KIND_GROUP_INVITE,
  type GroupInvite,
  type GroupDescriptor,
} from '@freeport/protocol';
import { RIDESHARE_CATEGORY } from '../src/categories';
import { groupPrefsPatch, recordGroupJoin, loadJoinedGroups, joinedGroupGids, type JoinedGroup } from '../src/groups';

const adminSk = generateSecretKey();

function inviteFor(descriptor: GroupDescriptor): GroupInvite {
  const ev = finalizeEvent(
    { kind: KIND_GROUP_INVITE, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'n' + Math.random()]], content: JSON.stringify(descriptor) },
    adminSk,
  );
  return verifyGroupEvent(ev)!;
}

beforeEach(async () => {
  const kv = (await import('../src/kv')) as any;
  kv.__store.clear();
});

describe('groupPrefsPatch (join-flow configuration)', () => {
  it('a rideshare group keeps the implicit category (browseCategory = "")', () => {
    const d = makeGroupDescriptor({ name: 'Drivers', category: RIDESHARE_CATEGORY, subcategory: 'Motorbike' })!;
    expect(groupPrefsPatch(d)).toEqual({ browseCategory: '', browseSubcategory: 'Motorbike' });
    // Rideshare must NOT force the Service/Product vertical on.
    expect('servicesEnabled' in groupPrefsPatch(d)).toBe(false);
  });

  it('a service group enables the vertical and sets the category', () => {
    const d = makeGroupDescriptor({ name: 'Cleaners', category: 'Home Services', subcategory: 'Cleaning' })!;
    expect(groupPrefsPatch(d)).toEqual({ servicesEnabled: true, browseCategory: 'Home Services', browseSubcategory: 'Cleaning' });
  });

  it('defaults subcategory to "" when the group has none', () => {
    const d = makeGroupDescriptor({ name: 'Crypto OTC', category: 'Crypto' })!;
    expect(groupPrefsPatch(d)).toEqual({ servicesEnabled: true, browseCategory: 'Crypto', browseSubcategory: '' });
  });
});

describe('local membership recording', () => {
  const group: JoinedGroup = { gid: 'a'.repeat(64), name: 'Drivers', admin: 'b'.repeat(64), category: RIDESHARE_CATEGORY, joinedAt: 1 };

  it('records a joined group and reads it back', async () => {
    await recordGroupJoin(group);
    const groups = await loadJoinedGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].gid).toBe(group.gid);
  });

  it('is idempotent per gid (re-joining refreshes, does not duplicate)', async () => {
    await recordGroupJoin(group);
    await recordGroupJoin({ ...group, name: 'Renamed', joinedAt: 2 });
    const groups = await loadJoinedGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Renamed');
  });

  it('joinedGroupGids collects every id', async () => {
    await recordGroupJoin(group);
    await recordGroupJoin({ ...group, gid: 'c'.repeat(64) });
    const gids = joinedGroupGids(await loadJoinedGroups());
    expect(gids.has('a'.repeat(64))).toBe(true);
    expect(gids.has('c'.repeat(64))).toBe(true);
  });
});

describe('same-group badge matching', () => {
  it('shows the group name when the viewer and peer share a verified group', () => {
    const inv = inviteFor(makeGroupDescriptor({ name: 'Hanoi Drivers', category: RIDESHARE_CATEGORY })!);
    const myGids = new Set([inv.gid]);
    expect(matchSameGroup(myGids, [inv])).toBe('Hanoi Drivers');
  });

  it('shows nothing when the viewer is in no shared group', () => {
    const a = inviteFor(makeGroupDescriptor({ name: 'A', category: RIDESHARE_CATEGORY })!);
    const b = inviteFor(makeGroupDescriptor({ name: 'B', category: RIDESHARE_CATEGORY })!);
    expect(matchSameGroup(new Set([a.gid]), [b])).toBeNull();
  });
});
