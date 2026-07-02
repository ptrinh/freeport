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
import { eventGeohash, matches, unionKinds } from './match.js';
import { dmCoalesceDue } from './coalesce.js';
import type { SubStore, SubRecord } from './store.js';

const KIND_DM = 4;
// Freeport sends negotiation CONTROL messages (offers, accepts, counters, stage
// updates, contact exchange, the auto-shared trip link) as kind-4 DMs too, not
// just human chat. The notifier is content-blind (NIP-04), so it can't tell them
// apart — without this, an active deal spams "New message". Coalesce: at most one
// DM push per subscriber per this window. Tune with DM_NOTIFY_COOLDOWN_SEC.
const DM_COOLDOWN_MS = Math.max(0, Number(process.env.DM_NOTIFY_COOLDOWN_SEC ?? 30)) * 1000;

export class Watcher {
  private readonly pool = new SimplePool();
  private readonly expo = new Expo();
  private intentSub: { close: () => void } | null = null;
  private dmSub: { close: () => void } | null = null;
  private intentKinds: number[] = [];
  private pubkeys: string[] = [];
  /**
   * Bounded dedupe of (subId|eventId) already pushed — two generations
   * instead of a single set that clear()s: a wholesale clear mid-burst
   * re-allowed duplicate pushes for everything in flight. Rotating keeps the
   * most recent half-window always intact.
   */
  private seen = new Set<string>();
  private seenPrev = new Set<string>();
  private static readonly SEEN_GENERATION_MAX = 25000;
  /** Last DM-notification time per subscriber id, for burst coalescing. */
  private readonly lastDmPush = new Map<string, number>();

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

  /** (Re)open the relay subscriptions if the watched kinds / pubkeys changed. */
  refresh(): void {
    const recs = this.store.all();

    const nextKinds = unionKinds(recs.map((s) => s.filters)).sort();
    if (!this.intentSub || nextKinds.join(',') !== this.intentKinds.join(',')) {
      this.intentKinds = nextKinds;
      this.intentSub?.close();
      this.intentSub = this.pool.subscribeMany(
        this.relays,
        { kinds: this.intentKinds, since: Math.floor(Date.now() / 1000) - 60 } as any, // 60s overlap: a re-subscribe must not drop events published in the gap (dedupe absorbs the replays)
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
          { kinds: [KIND_DM], '#p': this.pubkeys, since: Math.floor(Date.now() / 1000) - 60 } as any, // 60s overlap: a re-subscribe must not drop events published in the gap (dedupe absorbs the replays)
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
    // Index lookup: only subs watching a matching topic (or with no topic
    // filter) are candidates; `matches()` still does the precise kinds+geohash test.
    const evTopics = ev.tags.filter((t) => t[0] === 't').map((t) => t[1]);
    // Geohash once per EVENT; fan pushes out concurrently — serial awaits
    // (~100-300ms each) blocked processing of every subsequent relay event.
    const geohash = eventGeohash(ev);
    const sends: Promise<void>[] = [];
    for (const rec of this.store.intentCandidates(evTopics)) {
      if (!matches(ev, rec.filters, geohash)) continue;
      sends.push(this.maybePush(rec, ev.id, {
        body,
        tag: 'freeport-intent',
        // Tapping it should land on Browse (where nearby posts live).
        data: { kind: ev.kind, id: ev.id, tab: 'browse', url: '/?tab=browse' },
      }));
    }
    await Promise.allSettled(sends);
  }

  private async onDM(ev: Event): Promise<void> {
    const recipients = ev.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
    // Index lookup by recipient pubkey — O(recipients), not O(all subscribers).
    await Promise.allSettled(
      this.store.subsForPubkeys(recipients).map((rec) =>
        this.maybePush(rec, ev.id, { body: 'New message', tag: 'freeport-dm', data: { tab: 'messages', url: '/?tab=messages' } }, rec.id),
      ),
    );
  }

  /**
   * @param coalesceKey when set, collapse pushes for this key into one per
   *   DM_COOLDOWN_MS (used for DMs, which include bursty control traffic).
   */
  private async maybePush(rec: SubRecord, eventId: string, body: { body: string; tag: string; data: Record<string, unknown> }, coalesceKey?: string): Promise<void> {
    if (this.alreadyPushed(`${rec.id}|${eventId}`)) return;
    if (coalesceKey && DM_COOLDOWN_MS > 0) {
      const now = Date.now();
      if (!dmCoalesceDue(this.lastDmPush.get(coalesceKey), now, DM_COOLDOWN_MS)) return; // within the window → skip (already notified recently)
      this.lastDmPush.set(coalesceKey, now);
    }
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
