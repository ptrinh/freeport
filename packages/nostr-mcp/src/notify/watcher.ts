/**
 * Relay watcher → Web Push fan-out. Two concerns over one shared pool:
 *
 *  - INTENTS (kinds 32101/32102…): pushed to subscribers whose filters match
 *    (topic / geohash radius). "New request/offer near you".
 *  - DIRECT MESSAGES (kind 4): pushed to a subscriber whose watched pubkey is
 *    the recipient (`#p`). "New message". Content-blind — the DM is NIP-04
 *    encrypted and never decrypted here.
 *
 * Dedupes so a relay echo never double-notifies, and prunes subscriptions the
 * push service reports as gone (404/410).
 */
import { SimplePool } from 'nostr-tools/pool';
import type { Event } from 'nostr-tools';
import webpush from 'web-push';
import { Expo } from 'expo-server-sdk';
import { matches, unionKinds } from './match.js';
import type { SubStore, SubRecord } from './store.js';

const KIND_DM = 4;

export class Watcher {
  private readonly pool = new SimplePool();
  private readonly expo = new Expo();
  private intentSub: { close: () => void } | null = null;
  private dmSub: { close: () => void } | null = null;
  private intentKinds: number[] = [];
  private pubkeys: string[] = [];
  /** Bounded dedupe of (subId|eventId) already pushed. */
  private seen = new Set<string>();

  constructor(private readonly relays: string[], private readonly store: SubStore) {}

  /** (Re)open the relay subscriptions if the watched kinds / pubkeys changed. */
  refresh(): void {
    const recs = this.store.all();

    const nextKinds = unionKinds(recs.map((s) => s.filters)).sort();
    if (!this.intentSub || nextKinds.join(',') !== this.intentKinds.join(',')) {
      this.intentKinds = nextKinds;
      this.intentSub?.close();
      this.intentSub = this.pool.subscribeMany(
        this.relays,
        { kinds: this.intentKinds, since: Math.floor(Date.now() / 1000) } as any,
        { onevent: (ev: Event) => this.onIntent(ev) },
      );
    }

    const nextPubkeys = [...new Set(recs.map((s) => s.pubkey).filter(Boolean) as string[])].sort();
    if (nextPubkeys.join(',') !== this.pubkeys.join(',')) {
      this.pubkeys = nextPubkeys;
      this.dmSub?.close();
      this.dmSub = null;
      if (this.pubkeys.length) {
        this.dmSub = this.pool.subscribeMany(
          this.relays,
          { kinds: [KIND_DM], '#p': this.pubkeys, since: Math.floor(Date.now() / 1000) } as any,
          { onevent: (ev: Event) => this.onDM(ev) },
        );
      }
    }
    console.error(`[notify] watching intents [${this.intentKinds}] + DMs for ${this.pubkeys.length} pubkeys`);
  }

  private async onIntent(ev: Event): Promise<void> {
    const offer = ev.kind % 2 === 1; // 32101 offer (odd) / 32102 request (even)
    // Intents are PUBLIC, so the push can name what it is (unlike encrypted DMs).
    let title = '';
    try { const c = JSON.parse(ev.content); if (typeof c?.title === 'string') title = c.title.trim().slice(0, 80); } catch { /* ignore */ }
    const label = offer ? 'New offer near you' : 'New request near you';
    const body = title ? `${label}: ${title}` : label;
    for (const rec of this.store.all()) {
      if (!matches(ev, rec.filters)) continue;
      await this.maybePush(rec, ev.id, {
        body,
        tag: 'freeport-intent',
        data: { kind: ev.kind, id: ev.id, url: '/' },
      });
    }
  }

  private async onDM(ev: Event): Promise<void> {
    const recipients = new Set(ev.tags.filter((t) => t[0] === 'p').map((t) => t[1]));
    for (const rec of this.store.all()) {
      if (!rec.pubkey || !recipients.has(rec.pubkey)) continue;
      await this.maybePush(rec, ev.id, { body: 'New message', tag: 'freeport-dm', data: { url: '/' } });
    }
  }

  private async maybePush(rec: SubRecord, eventId: string, body: { body: string; tag: string; data: Record<string, unknown> }): Promise<void> {
    const key = `${rec.id}|${eventId}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 50000) this.seen.clear(); // bound memory
    if (rec.expoPushToken) await this.pushExpo(rec, body);
    else if (rec.subscription) await this.pushWeb(rec, body);
  }

  /** Native push via Expo's service (uses the APNs/FCM key held in EAS). */
  private async pushExpo(rec: SubRecord, body: { body: string; tag: string; data: Record<string, unknown> }): Promise<void> {
    const token = rec.expoPushToken!;
    if (!Expo.isExpoPushToken(token)) { this.store.remove(rec.id); return; }
    try {
      const [ticket] = await this.expo.sendPushNotificationsAsync([
        { to: token, title: 'Freeport', body: body.body, data: body.data, sound: 'default' },
      ]);
      if (ticket.status === 'error' && (ticket.details as any)?.error === 'DeviceNotRegistered') {
        this.store.remove(rec.id); // token revoked — prune
        this.refresh();
      }
    } catch (err) {
      console.error(`[notify] expo push failed for ${rec.id}`, err);
    }
  }

  private async pushWeb(rec: SubRecord, body: { body: string; tag: string; data: Record<string, unknown> }): Promise<void> {
    const payload = JSON.stringify({ title: 'Freeport', ...body });
    try {
      await webpush.sendNotification(rec.subscription as any, payload);
    } catch (err: any) {
      const code = err?.statusCode;
      if (code === 404 || code === 410) {
        this.store.remove(rec.id); // subscription expired/unsubscribed
        console.error(`[notify] pruned dead subscription ${rec.id}`);
        this.refresh();
      } else {
        console.error(`[notify] push failed (${code ?? 'err'}) for ${rec.id}`);
      }
    }
  }

  close(): void {
    this.intentSub?.close();
    this.dmSub?.close();
    this.pool.close(this.relays);
  }
}
