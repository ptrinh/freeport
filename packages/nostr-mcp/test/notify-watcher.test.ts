/**
 * Notification fan-out (Watcher): who receives a push and who doesn't. Drives
 * the real Watcher + real SubStore (its topic/pubkey indexes are the routing)
 * with web-push and expo-server-sdk mocked, so no network is touched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KIND_INTENT_OFFER, KIND_INTENT_REQUEST, geohashEncode } from '@freeport/protocol';

const sent: any[] = [];               // web-push sends: { subscription, payload }
let webpushFails = false;             // when true, sendNotification rejects (prune path)
const expoSends: any[] = [];          // expo push tickets

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (subscription: any, payload: string) => {
      if (webpushFails) { const e: any = new Error('gone'); e.statusCode = 410; throw e; }
      sent.push({ subscription, payload });
    }),
  },
}));
vi.mock('expo-server-sdk', () => ({
  Expo: class {
    static isExpoPushToken() { return true; }
    async sendPushNotificationsAsync(msgs: any[]) { expoSends.push(...msgs); return msgs.map(() => ({ status: 'ok' })); }
  },
}));

import { Watcher } from '../src/notify/watcher.js';
import { SubStore } from '../src/notify/store.js';

process.setMaxListeners(0); // many SubStore instances each register exit hooks

const SG = { lat: 1.3008, lon: 103.8427 };
const HANOI = { lat: 21.0278, lon: 105.8342 }; // ~3,000 km from SG

let tmpN = 0;
function newStore(): SubStore {
  return new SubStore(join(tmpdir(), `freeport-notify-test-${process.pid}-${tmpN++}.json`), 60_000);
}
function newWatcher(store: SubStore): Watcher {
  const w = new Watcher(['ws://fake'], store);
  // No real relay: refresh() (called on prune) must not open sockets.
  (w as any).pool = { subscribeMany: () => ({ close() {} }), close() {}, destroy() {} };
  return w;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

function intentEv(over: { topics?: string[]; geohash?: string; kind?: number; id?: string } = {}): any {
  const tags: string[][] = (over.topics ?? []).map((t) => ['t', t]);
  if (over.geohash) tags.push(['g', over.geohash]);
  return { kind: over.kind ?? KIND_INTENT_OFFER, tags, content: JSON.stringify({ title: 'Leaky tap repair' }), id: over.id ?? 'ev-1', pubkey: 'consumer-pk', created_at: 0, sig: '' };
}
function dmEv(recipient: string, id = 'dm-1'): any {
  return { kind: 4, tags: [['p', recipient]], content: 'ciphertext', id, pubkey: 'sender-pk', created_at: 0, sig: '' };
}
const webSub = (endpoint: string) => ({ endpoint, keys: { p256dh: 'k', auth: 'a' } });
const endpoints = () => sent.map((s) => s.subscription.endpoint);

let store: SubStore;
let watcher: Watcher;
beforeEach(() => {
  sent.length = 0; expoSends.length = 0; webpushFails = false;
  store = newStore();
  watcher = newWatcher(store);
});
afterEach(() => watcher.close());

describe('intent notifications by subcategory topic', () => {
  it('pushes to a provider listening to the posted subcat, not one on a different subcat', async () => {
    store.upsertWeb(webSub('https://push/plumbing'), { topics: ['sg_home_plumbing'] });
    store.upsertWeb(webSub('https://push/electrical'), { topics: ['sg_home_electrical'] });

    await (watcher as any).onIntent(intentEv({ topics: ['sg_home_plumbing'] }));
    await flush();

    expect(endpoints()).toEqual(['https://push/plumbing']);
  });

  it('a provider scoped to the broad market topic still catches a subcat post', async () => {
    // Posts carry the market tag plus the subcat tag; a provider watching the
    // whole market receives it, a provider on a sibling subcat does not.
    store.upsertWeb(webSub('https://push/all-service'), { topics: ['sg-service'] });
    store.upsertWeb(webSub('https://push/electrical'), { topics: ['sg_home_electrical'] });

    await (watcher as any).onIntent(intentEv({ topics: ['sg-service', 'sg_home_plumbing'] }));
    await flush();

    expect(endpoints()).toEqual(['https://push/all-service']);
  });

  it('a DM-only subscriber (no topic, no geo) gets no intent notifications', async () => {
    store.upsertWeb(webSub('https://push/dm-only'), {}, 'alice-pk'); // Browse alerts off
    await (watcher as any).onIntent(intentEv({ topics: ['sg_home_plumbing'] }));
    await flush();
    expect(sent).toHaveLength(0);
  });

  it('does not push to anyone when no subscriber matches the subcat', async () => {
    store.upsertWeb(webSub('https://push/electrical'), { topics: ['sg_home_electrical'] });
    await (watcher as any).onIntent(intentEv({ topics: ['sg_home_plumbing'] }));
    await flush();
    expect(sent).toHaveLength(0);
  });
});

describe('geohash radius within the same subcat', () => {
  it('pushes to the nearby provider and skips the far one', async () => {
    store.upsertWeb(webSub('https://push/near'), { topics: ['sg_home_plumbing'], near: { ...SG, radiusKm: 5 } });
    store.upsertWeb(webSub('https://push/far'), { topics: ['sg_home_plumbing'], near: { ...HANOI, radiusKm: 5 } });

    await (watcher as any).onIntent(intentEv({ topics: ['sg_home_plumbing'], geohash: geohashEncode(SG.lat, SG.lon, 8) }));
    await flush();

    expect(endpoints()).toEqual(['https://push/near']);
  });
});

describe('DM notifications by watched pubkey', () => {
  it('notifies the subscriber watching the recipient pubkey, not one watching another', async () => {
    store.upsertWeb(webSub('https://push/alice'), {}, 'alice-pk');
    store.upsertWeb(webSub('https://push/bob'), {}, 'bob-pk');

    await (watcher as any).onDM(dmEv('alice-pk'));
    await flush();

    expect(endpoints()).toEqual(['https://push/alice']);
    expect(JSON.parse(sent[0].payload).body).toBe('New message');
  });
});

describe('dedupe and coalescing', () => {
  it('a relay echo (same event id) pushes only once', async () => {
    store.upsertWeb(webSub('https://push/p'), { topics: ['sg_home_plumbing'] });
    const ev = intentEv({ topics: ['sg_home_plumbing'], id: 'same-id' });
    await (watcher as any).onIntent(ev);
    await (watcher as any).onIntent(ev); // duplicate delivery
    await flush();
    expect(sent).toHaveLength(1);
  });

  it('bursty DMs to one subscriber coalesce into a single push within the cooldown', async () => {
    store.upsertWeb(webSub('https://push/alice'), {}, 'alice-pk');
    await (watcher as any).onDM(dmEv('alice-pk', 'dm-1'));
    await (watcher as any).onDM(dmEv('alice-pk', 'dm-2')); // different event, same recipient, within window
    await flush();
    expect(sent).toHaveLength(1);
  });
});

describe('transport + pruning', () => {
  it('sends native pushes to an Expo-token subscriber', async () => {
    store.upsertExpo('ExponentPushToken[xxx]', { topics: ['sg_home_plumbing'] });
    await (watcher as any).onIntent(intentEv({ topics: ['sg_home_plumbing'] }));
    await flush();
    expect(sent).toHaveLength(0);        // not a web push
    expect(expoSends).toHaveLength(1);
    expect(expoSends[0].body).toContain('offer'); // "New offer near you…"
  });

  it('prunes a web subscription the push service reports as gone (410)', async () => {
    store.upsertWeb(webSub('https://push/dead'), { topics: ['sg_home_plumbing'] });
    expect(store.size()).toBe(1);
    webpushFails = true;
    await (watcher as any).onIntent(intentEv({ topics: ['sg_home_plumbing'] }));
    await flush();
    expect(store.size()).toBe(0);
  });

  it('ignores an event of a kind no one subscribed to', async () => {
    store.upsertWeb(webSub('https://push/p'), { topics: ['sg_home_plumbing'] });
    await (watcher as any).onIntent(intentEv({ topics: ['sg_home_plumbing'], kind: 1 }));
    await flush();
    expect(sent).toHaveLength(0);
  });
});
