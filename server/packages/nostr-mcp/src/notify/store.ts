/**
 * Subscription store — in-memory with secondary indexes, persisted to a JSON
 * file on disk (same format as before; loads existing files unchanged).
 *
 * Scaling notes:
 *  - Records live in a Map; matching goes through indexes (pubkey -> subs for
 *    DMs, topic -> subs for intents) so a single event is matched in
 *    O(recipients/topics), not O(all subscribers).
 *  - Writes are DEBOUNCED: a burst of subscribe/unsubscribe coalesces into one
 *    file write instead of rewriting the whole JSON on every change. A final
 *    synchronous flush runs on process exit so nothing in the window is lost.
 *
 * Content-blind: we keep only the push endpoint/keys (opaque) and coarse filter
 * criteria the user chose. No identity, no message content.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
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
  /** Last subscribe/re-subscribe time. The app re-POSTs /subscribe on launch
   *  (a heartbeat), so this trails real device activity — the TTL sweep prunes
   *  records that stop refreshing (e.g. the app was deleted and never pushed to,
   *  so the 404/410/DeviceNotRegistered prune never fired). */
  lastSeenAt: number;
}

export class SubStore {
  private map = new Map<string, SubRecord>();
  // Secondary indexes (rebuilt from `map`; kept in sync on put/remove).
  private byPubkey = new Map<string, Set<string>>(); // pubkey -> sub ids (DM routing)
  private byTopic = new Map<string, Set<string>>();   // topic  -> sub ids (intent routing)
  private noTopic = new Set<string>();                // subs with no topic filter (match any intent topic)
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly path: string, private readonly flushDelayMs = 1500) {
    if (existsSync(path)) {
      try {
        for (const r of JSON.parse(readFileSync(path, 'utf8')) as SubRecord[]) {
          if (typeof r.lastSeenAt !== 'number') r.lastSeenAt = r.createdAt; // migrate pre-TTL records
          this.map.set(r.id, r);
          this.index(r);
        }
      } catch { /* start empty on corrupt file */ }
    }
    // Last-chance synchronous flush so a pending debounced write isn't lost.
    const onExit = () => { if (this.flushTimer) this.flushNow(); };
    process.once('SIGTERM', () => { onExit(); process.exit(0); });
    process.once('SIGINT', () => { onExit(); process.exit(0); });
    process.once('beforeExit', onExit);
  }

  private index(rec: SubRecord): void {
    if (rec.pubkey) {
      let s = this.byPubkey.get(rec.pubkey); if (!s) { s = new Set(); this.byPubkey.set(rec.pubkey, s); }
      s.add(rec.id);
    }
    const topics = rec.filters?.topics;
    if (topics?.length) {
      for (const t of topics) { let s = this.byTopic.get(t); if (!s) { s = new Set(); this.byTopic.set(t, s); } s.add(rec.id); }
    } else {
      this.noTopic.add(rec.id);
    }
  }

  private unindex(rec: SubRecord): void {
    if (rec.pubkey) { const s = this.byPubkey.get(rec.pubkey); if (s) { s.delete(rec.id); if (!s.size) this.byPubkey.delete(rec.pubkey); } }
    const topics = rec.filters?.topics;
    if (topics?.length) {
      for (const t of topics) { const s = this.byTopic.get(t); if (s) { s.delete(rec.id); if (!s.size) this.byTopic.delete(t); } }
    } else {
      this.noTopic.delete(rec.id);
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flushNow(), this.flushDelayMs);
  }

  private flushNow(): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    mkdirSync(dirname(this.path), { recursive: true });
    // Write to a temp file then atomically rename over the live file. A crash
    // mid-write can no longer leave a half-written (corrupt) subscriptions.json,
    // which the loader would discard on boot — wiping every push subscription.
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.map.values()], null, 2));
    renameSync(tmp, this.path);
  }

  /** Web Push subscription. id derived from the endpoint so re-subscribing updates in place. */
  upsertWeb(subscription: PushSubscriptionJSON, filters: SubFilters, pubkey?: string): SubRecord {
    return this.put(idForKey(subscription.endpoint), { subscription, filters, pubkey });
  }

  /** Native Expo Push token. id derived from the token. */
  upsertExpo(expoPushToken: string, filters: SubFilters, pubkey?: string): SubRecord {
    return this.put(idForKey(expoPushToken), { expoPushToken, filters, pubkey });
  }

  private put(id: string, partial: Omit<SubRecord, 'id' | 'createdAt' | 'lastSeenAt'>): SubRecord {
    const old = this.map.get(id);
    if (old) this.unindex(old);
    const now = Date.now();
    const rec: SubRecord = { id, ...partial, createdAt: old?.createdAt ?? now, lastSeenAt: now };
    this.map.set(id, rec);
    this.index(rec);
    this.scheduleFlush();
    return rec;
  }

  /**
   * Prune subscriptions not refreshed within `maxAgeMs` (by lastSeenAt). The app
   * re-subscribes on launch, so a record that goes stale means the device stopped
   * checking in — typically an uninstall the push-failure prune never caught
   * (its filters never matched an event, so we never tried to push to it).
   * Returns the number removed. Caller should `watcher.refresh()` if > 0.
   */
  sweepStale(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const stale: string[] = [];
    for (const rec of this.map.values()) if ((rec.lastSeenAt ?? rec.createdAt) < cutoff) stale.push(rec.id);
    for (const id of stale) this.remove(id);
    return stale.length;
  }

  /** Remove by push endpoint URL or Expo token (the app knows these, not the id). */
  removeByKey(key: string): boolean {
    return this.remove(idForKey(key));
  }

  remove(id: string): boolean {
    const rec = this.map.get(id);
    if (!rec) return false;
    this.unindex(rec);
    this.map.delete(id);
    this.scheduleFlush();
    return true;
  }

  all(): SubRecord[] { return [...this.map.values()]; }
  size(): number { return this.map.size; }

  /** Subscribers watching any of these pubkeys for inbound DMs. O(pubkeys). */
  subsForPubkeys(pubkeys: Iterable<string>): SubRecord[] {
    const out: SubRecord[] = [];
    const seen = new Set<string>();
    for (const pk of pubkeys) {
      const ids = this.byPubkey.get(pk);
      if (!ids) continue;
      for (const id of ids) { if (seen.has(id)) continue; seen.add(id); const r = this.map.get(id); if (r) out.push(r); }
    }
    return out;
  }

  /**
   * Candidate subscribers for an intent with these topic tags: those watching a
   * matching topic, plus those with no topic filter (which match any topic).
   * Callers still run the precise `matches()` (kinds + geohash radius) on each.
   */
  intentCandidates(eventTopics: Iterable<string>): SubRecord[] {
    const out: SubRecord[] = [];
    const seen = new Set<string>();
    const add = (id: string) => { if (seen.has(id)) return; seen.add(id); const r = this.map.get(id); if (r) out.push(r); };
    for (const t of eventTopics) { const ids = this.byTopic.get(t); if (ids) for (const id of ids) add(id); }
    for (const id of this.noTopic) add(id);
    return out;
  }
}

/** Stable, non-reversible id from a transport key (endpoint URL or Expo token). */
export function idForKey(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + key.length.toString(36);
}
