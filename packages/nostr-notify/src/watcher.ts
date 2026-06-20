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
import { matches, unionKinds } from './match.js';
import type { SubStore } from './store.js';

export class Watcher {
  private readonly pool = new SimplePool();
  private sub: { close: () => void } | null = null;
  private kinds: number[] = [];
  /** Bounded dedupe of (subId|eventId) already pushed. */
  private seen = new Set<string>();

  constructor(private readonly relays: string[], private readonly store: SubStore) {}

  /** (Re)open the relay subscription if the kind union changed. */
  refresh(): void {
    const next = unionKinds(this.store.all().map((s) => s.filters)).sort();
    if (this.sub && next.join(',') === this.kinds.join(',')) return;
    this.kinds = next;
    this.sub?.close();
    this.sub = this.pool.subscribeMany(
      this.relays,
      { kinds: this.kinds, since: Math.floor(Date.now() / 1000) } as any,
      { onevent: (ev: Event) => this.onEvent(ev) },
    );
    console.error(`[notify] watching kinds [${this.kinds}] on ${this.relays.length} relays`);
  }

  private async onEvent(ev: Event): Promise<void> {
    for (const rec of this.store.all()) {
      const key = `${rec.id}|${ev.id}`;
      if (this.seen.has(key)) continue;
      if (!matches(ev, rec.filters)) continue;
      this.seen.add(key);
      if (this.seen.size > 50000) this.seen.clear(); // bound memory
      await this.push(rec.id, rec.subscription, ev);
    }
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
