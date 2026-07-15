/**
 * kvCache — the bulk key/value store for large, frequently-rewritten blobs.
 *
 * COVERAGE NOTE / harness limitation: kvCache.ts loads expo-file-system with a
 * *synchronous* `require('expo-file-system/legacy')`. Under vitest that require
 * is neither resolvable nor interceptable by vi.mock (only dynamic `import()`
 * is), so — exactly as the module's own doc comment states ("under plain Node
 * (vitest) the module doesn't load, and we fall back to the kv.ts store") — the
 * file backend and its lazy SecureStore→file migration never activate here.
 * Those branches are native-only and can't be exercised under the node test
 * env. What IS observable in vitest is the fallback contract: with no FS,
 * kvCache is a faithful pass-through to kv.ts (SecureStore). That contract is
 * what these tests pin, on both the native module and its web sibling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory SecureStore backing kv.ts (shared by both modules under test).
const store = new Map<string, string>();
const kvGet = vi.fn(async (k: string) => store.get(k) ?? null);
const kvSet = vi.fn(async (k: string, v: string) => { store.set(k, v); });
const kvDelete = vi.fn(async (k: string) => { store.delete(k); });
vi.mock('../src/kv', () => ({
  kvGet: (k: string) => kvGet(k),
  kvSet: (k: string, v: string) => kvSet(k, v),
  kvDelete: (k: string) => kvDelete(k),
}));

import { kvCacheGet, kvCacheSet, kvCacheDelete } from '../src/kvCache';
import {
  kvCacheGet as webGet,
  kvCacheSet as webSet,
  kvCacheDelete as webDelete,
} from '../src/kvCache.web';

beforeEach(() => { store.clear(); vi.clearAllMocks(); });

describe('kvCache native fallback (no expo-file-system → delegates to kv)', () => {
  it('per-key set/get roundtrip goes through the kv store', async () => {
    await kvCacheSet('freeport.conversations', 'blob-1');
    expect(kvSet).toHaveBeenCalledWith('freeport.conversations', 'blob-1');
    expect(await kvCacheGet('freeport.conversations')).toBe('blob-1');
    expect(kvGet).toHaveBeenCalledWith('freeport.conversations');
  });

  it('missing key reads as null', async () => {
    expect(await kvCacheGet('freeport.absent')).toBeNull();
  });

  it('delete clears the kv copy (so a wipe really wipes)', async () => {
    await kvCacheSet('freeport.escrows', 'x');
    await kvCacheDelete('freeport.escrows');
    expect(kvDelete).toHaveBeenCalledWith('freeport.escrows');
    expect(await kvCacheGet('freeport.escrows')).toBeNull();
  });
});

describe('kvCache.web (localStorage-backed, mirrors the native API)', () => {
  it('set/get/delete delegate straight to kv', async () => {
    await webSet('freeport.outbox', 'w1');
    expect(kvSet).toHaveBeenCalledWith('freeport.outbox', 'w1');
    expect(await webGet('freeport.outbox')).toBe('w1');
    await webDelete('freeport.outbox');
    expect(kvDelete).toHaveBeenCalledWith('freeport.outbox');
    expect(await webGet('freeport.outbox')).toBeNull();
  });
});
