/**
 * Web bulk-cache storage — same localStorage store as kv.web.ts (which is
 * already the web backend for ALL keys), so no migration is needed here.
 * This module exists only to mirror the native kvCache.ts API.
 */
import { kvGet, kvSet, kvDelete } from './kv';

export const kvCacheGet = (key: string): Promise<string | null> => kvGet(key);
export const kvCacheSet = (key: string, value: string): Promise<void> => kvSet(key, value);
export const kvCacheDelete = (key: string): Promise<void> => kvDelete(key);
