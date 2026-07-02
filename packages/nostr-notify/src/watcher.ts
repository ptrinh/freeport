/**
 * Relay watcher → Web Push fan-out.
 *
 * Holds ONE long-lived relay subscription (over a shared pool) for the union of
 * subscriber kinds. For each new event it checks every subscriber's filters and
 * pushes a short, content-blind notification to the matches. Dedupes so a relay
 * echo never double-notifies, and prunes subscriptions the push service reports
 * as gone (404/410).
 */
import { SimplePool } from 'nostr-tools/pool';
import type { Event } from 'nostr-tools';
import webpush from 'web-push';
import { eventGeohash, matches, unionKinds } from './match.js';
import type { SubStore } from './store.js';

export class Watcher {
  private readonly pool = new SimplePool();
  private sub: { close: () => void } | null = null;
  private kinds: number[] = [];
  /**
   * Bounded dedupe of (subId|eventId) already pushed — two generations
   * instead of a single set that clear()s: a wholesale clear right as a relay
   * echoes a burst re-allowed duplicate pushes for everything in flight.
   * Rotating keeps the most recent half-window always intact.
   */
  private seen = new Set<string>();
  private seenPrev = new Set<string>();
  private static readonly SEEN_GENERATION_MAX = 25000;

  private alreadyPushed(key: string): boolean {
    if (this.seen.has(key) || this.seenPrev.has(key)) return true;
    this.seen.add(key);
    if (this.seen.size > Watcher.SEEN_GENERATION_MAX) {
      this.seenPrev = this.seen;
      this.seen = new Set();
    }
    return false;
  }

  constructor(private readonly relays: string[], private readonly store: SubStore) {}

  /** (Re)open the relay subscription if the kind union changed. */
  refresh(): void {
    const next = unionKinds(this.store.all().map((s) => s.filters)).sort();
    if (this.sub && next.join(',') === this.kinds.join(',')) return;
    this.kinds = next;
    this.sub?.close();
    this.sub = this.pool.subscribeMany(
      this.relays,
      { kinds: this.kinds, since: Math.floor(Date.now() / 1000) - 60 } as any, // 60s overlap: a re-subscribe must not drop events published in the gap (dedupe absorbs the replays)
      { onevent: (ev: Event) => this.onEvent(ev) },
    );
    console.error(`[notify] watching kinds [${this.kinds}] on ${this.relays.length} relays`);
  }

  private async onEvent(ev: Event): Promise<void> {
    // Geohash once per EVENT (its JSON.parse fallback is the costly part),
    // and fan pushes out concurrently — serial awaits meant S subscribers ×
    // ~100-300ms per push blocked processing of every subsequent relay event.
    const geohash = eventGeohash(ev);
    const sends: Promise<void>[] = [];
    for (const rec of this.store.all()) {
      if (!matches(ev, rec.filters, geohash)) continue;
      if (this.alreadyPushed(`${rec.id}|${ev.id}`)) continue;
      sends.push(this.push(rec.id, rec.subscription, ev));
    }
    await Promise.allSettled(sends);
  }

  private async push(id: string, subscription: any, ev: Event): Promise<void> {
    const offer = ev.kind % 2 === 1; // 32101 offer (odd) / 32102 request (even)
    const payload = JSON.stringify({
      title: 'Freeport',
      body: offer ? 'New offer near you' : 'New request near you',
      tag: 'freeport-intent',
      data: { kind: ev.kind, id: ev.id },
    });
    try {
      await webpush.sendNotification(subscription, payload);
    } catch (err: any) {
      const code = err?.statusCode;
      if (code === 404 || code === 410) {
        this.store.remove(id); // subscription expired/unsubscribed
        console.error(`[notify] pruned dead subscription ${id}`);
        this.refresh();
      } else {
        console.error(`[notify] push failed (${code ?? 'err'}) for ${id}`);
      }
    }
  }

  close(): void {
    this.sub?.close();
    this.pool.close(this.relays);
  }
}
