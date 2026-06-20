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
  subscription: PushSubscriptionJSON;
  filters: SubFilters;
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

  /** id is derived from the endpoint so re-subscribing updates in place. */
  upsert(subscription: PushSubscriptionJSON, filters: SubFilters): SubRecord {
    const id = idForEndpoint(subscription.endpoint);
    const rec: SubRecord = { id, subscription, filters, createdAt: this.map.get(id)?.createdAt ?? Date.now() };
    this.map.set(id, rec);
    this.flush();
    return rec;
  }

  remove(id: string): boolean {
    const had = this.map.delete(id);
    if (had) this.flush();
    return had;
  }

  all(): SubRecord[] { return [...this.map.values()]; }
  size(): number { return this.map.size; }
}

/** Stable, non-reversible id from the push endpoint URL. */
export function idForEndpoint(endpoint: string): string {
  let h = 0;
  for (let i = 0; i < endpoint.length; i++) h = (Math.imul(31, h) + endpoint.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + endpoint.length.toString(36);
}
