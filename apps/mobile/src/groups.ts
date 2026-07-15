/**
 * Group import — local membership store + join-flow configuration.
 *
 * Membership is device-local (it rides in the prefs store, so it cloud-syncs and
 * survives restore like any other setting). The pure helpers here decide how a
 * group's market maps onto Browse preferences and record the join.
 */
import type { GroupDescriptor } from '@freeport/protocol';
import { RIDESHARE_CATEGORY } from './categories';
import { loadPrefs, savePrefs, type Prefs } from './prefs';

export interface JoinedGroup {
  /** Immutable group id (the admin-signed invite event id). */
  gid: string;
  name: string;
  /** Admin pubkey (hex). */
  admin: string;
  category: string;
  subcategory?: string;
  topics?: string[];
  /** When the user joined (ms epoch). */
  joinedAt: number;
}

/**
 * The Browse-pref patch that opens Browse straight into a group's market. Pure
 * (unit-tested). Rideshare is the implicit category — stored as '' so it matches
 * the app's existing fallback (see categories.ts / SettingsTab). Any other
 * market lives behind the Service/Product vertical, so joining enables it.
 */
export function groupPrefsPatch(descriptor: GroupDescriptor): Partial<Prefs> {
  const isRideshare = descriptor.category === RIDESHARE_CATEGORY;
  return {
    ...(isRideshare ? {} : { servicesEnabled: true }),
    browseCategory: isRideshare ? '' : descriptor.category,
    browseSubcategory: descriptor.subcategory ?? '',
  };
}

export async function loadJoinedGroups(): Promise<JoinedGroup[]> {
  return (await loadPrefs()).groups;
}

/** Record a join locally (idempotent per gid — re-joining refreshes it, keeping
 *  it newest-first). Returns the updated list. */
export async function recordGroupJoin(group: JoinedGroup): Promise<JoinedGroup[]> {
  const current = (await loadPrefs()).groups;
  const next = [group, ...current.filter((g) => g.gid !== group.gid)];
  await savePrefs({ groups: next });
  return next;
}

/** The set of group ids the local user has joined (for same-group matching). */
export function joinedGroupGids(groups: JoinedGroup[]): Set<string> {
  return new Set(groups.map((g) => g.gid));
}
