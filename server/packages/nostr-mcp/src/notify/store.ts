/**
 * Subscription store — JSON file on disk. Each record pairs a browser Push
 * subscription with the filters that decide which intents trigger a push.
 *
 * Content-blind: we keep only the push endpoint/keys (opaque) and coarse
 * filter criteria the user chose. No identity, no message content.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface SubFilters {
  /** Event kinds of interest. Defaults to Freeport intent kinds if omitted. */
  kinds?: number[];
  /** Match if the event carries ANY of these topic (`t`) tags. */
  topics?: string[];
  /** Geographic radius filter. */
  near?: { lat: number; lon: number; radiusKm: number };
}

export interface SubRecord {
  id: string;
  /** Web Push transport (browser/PWA). Exactly one of subscription/expoPushToken is set. */
  subscription?: PushSubscriptionJSON;
  /** Native transport (Expo Push token, iOS/Android app). */
  expoPushToken?: string;
  filters: SubFilters;
  /** Nostr pubkey (hex) to watch for inbound DMs (kind 4). Optional. */
  pubkey?: string;
  createdAt: number;
}

export class SubStore {
  private map = new Map<string, SubRecord>();

  constructor(private readonly path: string) {
    if (existsSync(path)) {
      try {
        for (const r of JSON.parse(readFileSync(path, 'utf8')) as SubRecord[]) this.map.set(r.id, r);
      } catch { /* start empty on corrupt file */ }
    }
  }

  private flush(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify([...this.map.values()], null, 2));
  }

  /** Web Push subscription. id derived from the endpoint so re-subscribing updates in place. */
  upsertWeb(subscription: PushSubscriptionJSON, filters: SubFilters, pubkey?: string): SubRecord {
    return this.put(idForKey(subscription.endpoint), { subscription, filters, pubkey });
  }

  /** Native Expo Push token. id derived from the token. */
  upsertExpo(expoPushToken: string, filters: SubFilters, pubkey?: string): SubRecord {
    return this.put(idForKey(expoPushToken), { expoPushToken, filters, pubkey });
  }

  private put(id: string, partial: Omit<SubRecord, 'id' | 'createdAt'>): SubRecord {
    const rec: SubRecord = { id, ...partial, createdAt: this.map.get(id)?.createdAt ?? Date.now() };
    this.map.set(id, rec);
    this.flush();
    return rec;
  }

  /** Remove by push endpoint URL or Expo token (the app knows these, not the id). */
  removeByKey(key: string): boolean {
    return this.remove(idForKey(key));
  }

  remove(id: string): boolean {
    const had = this.map.delete(id);
    if (had) this.flush();
    return had;
  }

  all(): SubRecord[] { return [...this.map.values()]; }
  size(): number { return this.map.size; }
}

/** Stable, non-reversible id from a transport key (endpoint URL or Expo token). */
export function idForKey(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + key.length.toString(36);
}
