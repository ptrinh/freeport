/**
 * Web key/value storage — localStorage. NOTE: localStorage is readable by any
 * script on the origin (XSS, extensions), unlike the native keychain. The web
 * build should encourage key backup and, ideally, NIP-07 signer extensions.
 *
 * PROFILE ISOLATION (debug/testing): when the page is loaded with a
 * `?profile=N` (or `#profile=N`) query param, EVERY storage key is namespaced
 * with a `fp.p<N>.` prefix. This gives each profile its own identity key,
 * profile, prefs and saved negotiations — so two browser tabs
 * (`?profile=1` and `?profile=2`) act as two independent users (e.g. one
 * Passenger, one Driver) that can negotiate with each other for testing.
 * With NO param the prefix is empty, so existing single-profile users keep
 * their data untouched. See debug.web.ts for the `window.freeport` helpers.
 */

/** The active profile id from the URL (`?profile=2` → "2"), or "" if none. */
export function profileId(): string {
  try {
    const loc = globalThis.location;
    if (!loc) return '';
    const fromSearch = new URLSearchParams(loc.search).get('profile');
    // also allow #profile=N so it survives static-host routing quirks
    const fromHash = loc.hash ? new URLSearchParams(loc.hash.replace(/^#/, '')).get('profile') : null;
    const id = (fromSearch ?? fromHash ?? '').trim();
    return /^[a-zA-Z0-9_-]{1,16}$/.test(id) ? id : '';
  } catch {
    return '';
  }
}

/** Per-profile key prefix; "" for the default (no-param) profile. */
export function storagePrefix(): string {
  const id = profileId();
  return id ? `fp.p${id}.` : '';
}

/** Map a logical key to its profile-scoped storage key. */
export function storageKey(key: string): string {
  return storagePrefix() + key;
}

export async function kvGet(key: string): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(storageKey(key)) ?? null;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(storageKey(key), value);
  } catch { /* ignore */ }
}

export async function kvDelete(key: string): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(storageKey(key));
  } catch { /* ignore */ }
}
