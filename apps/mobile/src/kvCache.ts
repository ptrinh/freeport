/**
 * Bulk-cache key/value storage for LARGE, frequently-rewritten blobs (deal
 * logs, chat conversations, escrows, outbox). These used to live in
 * expo-secure-store, but the OS keychain is slow per-write and documented to
 * misbehave above ~2 KB values — and none of these blobs are secrets in the
 * keychain sense (they are app-sandbox data, same protection class as any
 * app file). Files under documentDirectory are still device-encrypted at
 * rest on both platforms.
 *
 * Each logical key is one file. Reads lazily migrate any existing value out
 * of SecureStore so updated installs keep their data. The web build swaps in
 * kvCache.web.ts (localStorage, same store as kv.web.ts) via Metro platform
 * resolution.
 *
 * expo-file-system is probed with a synchronous optional require (same
 * pattern as cachedImage.tsx): under plain Node (vitest) the module doesn't
 * load, and we fall back to the kv.ts store — behavior degrades to the
 * pre-migration one instead of breaking.
 *
 * Keep actual secrets (identity key, NWC credential, chat invite) in kv.ts.
 */
import { kvGet, kvSet, kvDelete } from './kv';

type FS = typeof import('expo-file-system/legacy');
let cached: FS | null | undefined;
function fs(): FS | null {
  if (cached === undefined) {
    try {
      const m: FS = require('expo-file-system/legacy');
      cached = m?.documentDirectory ? m : null;
    } catch {
      cached = null;
    }
  }
  return cached;
}

let dirReady: Promise<void> | null = null;
function ensureDir(FileSystem: FS): Promise<void> {
  if (!dirReady) {
    dirReady = FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}kvcache/`, { intermediates: true })
      .then(() => undefined)
      .catch(() => { /* already exists */ });
  }
  return dirReady;
}

// Keys are our own constants (word characters), but encode defensively so a
// key can never escape the cache directory.
const fileFor = (FileSystem: FS, key: string) =>
  `${FileSystem.documentDirectory}kvcache/${encodeURIComponent(key)}`;

export async function kvCacheGet(key: string): Promise<string | null> {
  const FileSystem = fs();
  if (!FileSystem) return kvGet(key);
  await ensureDir(FileSystem);
  try {
    return await FileSystem.readAsStringAsync(fileFor(FileSystem, key));
  } catch {
    // No file yet — migrate a pre-existing SecureStore value once.
    try {
      const legacy = await kvGet(key);
      if (legacy != null) {
        await kvCacheSet(key, legacy);
        kvDelete(key).catch(() => {});
        return legacy;
      }
    } catch { /* fall through */ }
    return null;
  }
}

export async function kvCacheSet(key: string, value: string): Promise<void> {
  const FileSystem = fs();
  if (!FileSystem) return kvSet(key, value);
  await ensureDir(FileSystem);
  await FileSystem.writeAsStringAsync(fileFor(FileSystem, key), value);
}

export async function kvCacheDelete(key: string): Promise<void> {
  const FileSystem = fs();
  if (FileSystem) {
    try { await FileSystem.deleteAsync(fileFor(FileSystem, key), { idempotent: true }); } catch { /* best-effort */ }
  }
  // Also clear any unmigrated SecureStore copy so a wipe really wipes.
  try { await kvDelete(key); } catch { /* best-effort */ }
}
