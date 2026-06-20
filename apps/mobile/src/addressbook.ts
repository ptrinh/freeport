/**
 * Local address book — recent destinations (auto-tracked) + pinned favourites.
 * Device-only (kv: SecureStore on native, localStorage on web). Not published.
 */
import { kvGet, kvSet } from './kv';
import { scheduleCloudSync } from './cloudSync';

const STORE_KEY = 'freeport.addressbook';
const MAX_RECENT = 12;

export interface AddressBook {
  recent: string[]; // most-recent first
  pinned: string[]; // user-pinned favourites
}

const EMPTY: AddressBook = { recent: [], pinned: [] };

export async function loadAddressBook(): Promise<AddressBook> {
  try {
    const raw = await kvGet(STORE_KEY);
    if (!raw) return { ...EMPTY };
    const p = JSON.parse(raw);
    return {
      recent: Array.isArray(p.recent) ? p.recent : [],
      pinned: Array.isArray(p.pinned) ? p.pinned : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

async function save(ab: AddressBook): Promise<void> {
  await kvSet(STORE_KEY, JSON.stringify(ab));
  scheduleCloudSync(); // keep the cloud backup in sync with saved-address changes
}

/** Overwrite the whole address book (used when restoring a backup). */
export async function replaceAddressBook(ab: AddressBook): Promise<void> {
  await save({
    recent: Array.isArray(ab?.recent) ? ab.recent : [],
    pinned: Array.isArray(ab?.pinned) ? ab.pinned : [],
  });
}

/** Record a used destination: dedupe (case-insensitive), prepend, cap. */
export async function addRecent(address: string): Promise<AddressBook> {
  const a = address.trim();
  if (!a) return loadAddressBook();
  const ab = await loadAddressBook();
  const recent = [a, ...ab.recent.filter((r) => r.toLowerCase() !== a.toLowerCase())].slice(0, MAX_RECENT);
  const next = { ...ab, recent };
  await save(next);
  return next;
}

/** Pin/unpin an address. Pinning also removes it from the recents list. */
export async function togglePinned(address: string): Promise<AddressBook> {
  const a = address.trim();
  if (!a) return loadAddressBook();
  const ab = await loadAddressBook();
  const isPinned = ab.pinned.some((p) => p.toLowerCase() === a.toLowerCase());
  const pinned = isPinned
    ? ab.pinned.filter((p) => p.toLowerCase() !== a.toLowerCase())
    : [a, ...ab.pinned];
  const recent = isPinned ? ab.recent : ab.recent.filter((r) => r.toLowerCase() !== a.toLowerCase());
  const next = { pinned, recent };
  await save(next);
  return next;
}

export function isPinned(ab: AddressBook, address: string): boolean {
  return ab.pinned.some((p) => p.toLowerCase() === address.trim().toLowerCase());
}
