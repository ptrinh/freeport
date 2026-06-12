/**
 * Nostr user profile — NIP-01 kind:0.
 *
 * The profile is stored locally in SecureStore and published to relays as a
 * kind:0 replaceable event. Counterparties fetch it via:
 *   REQ [{"kinds":[0],"authors":["<pubkey>"]}]
 *
 * Fields follow the NIP-01 / NIP-24 metadata spec so any Nostr client can
 * render them. We add nothing proprietary.
 */
import * as SecureStore from 'expo-secure-store';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';

const STORE_KEY = 'freeport.profile';

export interface UserProfile {
  name: string;    // display name
  picture: string; // URL (NIP-96 or any https://)
  about: string;   // bio / about me
}

const EMPTY: UserProfile = { name: '', picture: '', about: '' };

export async function loadProfile(): Promise<UserProfile> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    if (!raw) return { ...EMPTY };
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(profile));
}

/**
 * Publish kind:0 to the given relays. Replaces any prior profile event from
 * this keypair — relays keep only the latest replaceable event per pubkey+kind.
 * Returns the relay URLs that accepted the event.
 */
export async function publishProfile(
  sk: Uint8Array,
  profile: UserProfile,
  relays: string[],
): Promise<string[]> {
  const content: Record<string, string> = {};
  if (profile.name) content.name = profile.name;
  if (profile.picture) content.picture = profile.picture;
  if (profile.about) content.about = profile.about;

  const ev = finalizeEvent(
    {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify(content),
    },
    sk,
  );

  const pool = new SimplePool();
  const results = await Promise.allSettled(pool.publish(relays, ev));
  pool.close(relays);
  return results
    .map((r, i) => (r.status === 'fulfilled' ? relays[i] : null))
    .filter((r): r is string => r !== null);
}
