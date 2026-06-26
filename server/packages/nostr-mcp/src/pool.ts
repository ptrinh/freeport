/**
 * Shared relay pool + query cache — the scalability core.
 *
 * - ONE SimplePool process-wide: nostr-tools keeps a single websocket per relay
 *   URL and multiplexes every subscription over it, so N concurrent agent calls
 *   share M upstream sockets, not N×M. Never construct a pool per request.
 * - A short-TTL cache keyed by the normalized filter coalesces identical or
 *   repeated queries (agents poll) into one relay round-trip.
 * - In-flight de-duplication: concurrent identical queries await the same
 *   promise instead of each opening a subscription.
 *
 * Read-only. This module never signs or publishes.
 */
import { SimplePool } from 'nostr-tools/pool';
import type { Event, Filter } from 'nostr-tools';

export interface QueryOptions {
  /** Hard ceiling on how long to wait for relays (ms). */
  timeoutMs?: number;
  /** Cache TTL for this query (ms). 0 disables caching for the call. */
  cacheTtlMs?: number;
}

interface CacheEntry {
  at: number;
  events: Event[];
}

export class RelayPool {
  private readonly pool = new SimplePool();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<Event[]>>();

  constructor(
    readonly relays: string[],
    private readonly defaults: Required<QueryOptions> = { timeoutMs: 4000, cacheTtlMs: 20000 },
    private readonly cacheCap = 500,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Query relays for a single NIP-01 filter; deduped + cached. */
  async query(filter: Filter, relays?: string[], opts: QueryOptions = {}): Promise<Event[]> {
    const useRelays = relays?.length ? relays : this.relays;
    const ttl = opts.cacheTtlMs ?? this.defaults.cacheTtlMs;
    const timeout = opts.timeoutMs ?? this.defaults.timeoutMs;
    const key = JSON.stringify({ r: [...useRelays].sort(), f: normalizeFilter(filter) });

    if (ttl > 0) {
      const hit = this.cache.get(key);
      if (hit && this.now() - hit.at < ttl) return hit.events;
      const pending = this.inflight.get(key);
      if (pending) return pending;
    }

    const run = this.collect(useRelays, filter, timeout)
      .then((events) => {
        if (ttl > 0) this.put(key, events);
        return events;
      })
      .finally(() => this.inflight.delete(key));

    if (ttl > 0) this.inflight.set(key, run);
    return run;
  }

  /** Open a subscription, gather events until EOSE or timeout, then close. */
  private collect(relays: string[], filter: Filter, timeoutMs: number): Promise<Event[]> {
    return new Promise((resolve) => {
      const byId = new Map<string, Event>();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          sub.close();
        } catch {
          /* already closed */
        }
        resolve([...byId.values()]);
      };
      const timer = setTimeout(finish, timeoutMs);
      const sub = this.pool.subscribeMany(relays, filter as any, {
        onevent: (ev: Event) => {
          byId.set(ev.id, ev);
        },
        oneose: () => {
          // Initial stored events delivered by (at least one batch of) relays.
          // Give a brief grace for stragglers, then resolve early.
          setTimeout(finish, 150);
        },
      });
    });
  }

  private put(key: string, events: Event[]): void {
    if (this.cache.size >= this.cacheCap) {
      // Drop the oldest ~10% to keep insertion cheap.
      const drop = Math.ceil(this.cacheCap * 0.1);
      let i = 0;
      for (const k of this.cache.keys()) {
        this.cache.delete(k);
        if (++i >= drop) break;
      }
    }
    this.cache.set(key, { at: this.now(), events });
  }

  close(): void {
    try {
      this.pool.close(this.relays);
    } catch {
      /* noop */
    }
  }
}

/** Stable key form: sort tag-value arrays so order doesn't fragment the cache. */
function normalizeFilter(filter: Filter): Filter {
  const out: any = {};
  for (const k of Object.keys(filter).sort()) {
    const v = (filter as any)[k];
    out[k] = Array.isArray(v) ? [...v].sort() : v;
  }
  return out;
}
