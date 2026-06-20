/**
 * Key/value storage abstraction. Native uses expo-secure-store (keychain).
 * The web build swaps in kv.web.ts (localStorage) automatically via Metro's
 * platform resolution.
 */
import * as SecureStore from 'expo-secure-store';

// Profile isolation is a web-only debug aid (see kv.web.ts). On native there is
// no URL, so these are no-ops kept here only so cross-platform imports type-check.
export function profileId(): string { return ''; }
export function storagePrefix(): string { return ''; }
export function storageKey(key: string): string { return key; }

export async function kvGet(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function kvSet(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function kvDelete(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}
