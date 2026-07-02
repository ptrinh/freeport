import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { generateSecretKey } from 'nostr-tools/pure';
import { buildIntentEvent, DEMO_MARKET, DEMO_SCHEMA, geohashEncode } from '@freeport/protocol';
import { GroupStore } from '../src/notify/telegram/groups.js';
import { SendQueue } from '../src/notify/telegram/queue.js';
import { makeIntentFeed } from '../src/notify/telegram/feed.js';

process.setMaxListeners(0);
const SG = { lat: 1.3008, lon: 103.8427 };
const now = () => Math.floor(Date.now() / 1000);

// A fake Bot API capturing sends/edits; SendQueue runs with no real delay.
function fakeApi() {
  const sent: any[] = [], edited: any[] = [];
  let mid = 100;
  return {
    sent, edited,
    api: {
      async sendMessage(chatId: number, text: string, opts: any) { const message_id = ++mid; sent.push({ chatId, text, opts, message_id }); return { message_id, chat: { id: chatId } }; },
      async editMessageText(chatId: number, message_id: number, text: string) { edited.push({ chatId, message_id, text }); },
    } as any,
  };
}
const instantQueue = () => new SendQueue((_ms) => Promise.resolve(), () => 0);

function ride(payment = 'SGD 20', geohash?: string, d = 'ride-1', createdAt = now()) {
  return buildIntentEvent({
    side: 'request', market: DEMO_MARKET, schema: DEMO_SCHEMA, title: 'Orchard → Hougang',
    payload: { from: { name: 'Orchard' }, to: { name: 'Hougang' }, seats: 2, payment },
    window: { start: now() + 3600, end: now() + 5400 }, expiresAt: now() + 7200,
    topics: [DEMO_MARKET], d, createdAt,
    ...(geohash ? { geohashes: [geohash] } : {}),
  }, generateSecretKey());
}
function withdraw(d = 'ride-1', createdAt = now() + 10) {
  return buildIntentEvent({
    side: 'request', market: DEMO_MARKET, schema: DEMO_SCHEMA, title: 'Orchard → Hougang',
    payload: {}, window: undefined, expiresAt: now() + 600, topics: [DEMO_MARKET], d, createdAt,
  }, generateSecretKey());
}

let store: GroupStore, path: string;
beforeEach(() => { path = join(tmpdir(), `fp-tg-groups-${process.pid}-${Math.random().toString(36).slice(2)}.json`); store = new GroupStore(path, 60_000); });
afterEach(() => { try { rmSync(path); } catch {} });

describe('group feed', () => {
  it('posts a card to a chat watching the market, not one on another topic', async () => {
    store.addWatch(-100, { topics: [DEMO_MARKET] });
    store.addWatch(-200, { topics: ['sg-service'] });
    const { sent, api } = fakeApi();
    makeIntentFeed(store, api, instantQueue(), 'https://fp.example')(ride());
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(1);
    expect(sent[0].chatId).toBe(-100);
    expect(sent[0].text).toContain('Orchard → Hougang');
    expect(sent[0].text).toContain('💰 SGD 20');
    expect(sent[0].opts.buttons[0][0].url).toBe('https://fp.example/?tab=browse');
  });

  it('records the message and EDITS on a newer version of the same d-tag', async () => {
    store.addWatch(-100, { topics: [DEMO_MARKET] });
    const { sent, edited, api } = fakeApi();
    const feed = makeIntentFeed(store, api, instantQueue(), 'https://fp.example');
    feed(ride('SGD 20', undefined, 'ride-1', now()));
    await new Promise((r) => setTimeout(r, 0));
    feed(ride('SGD 25', undefined, 'ride-1', now() + 5)); // newer edit
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(1);
    expect(edited).toHaveLength(1);
    expect(edited[0].text).toContain('SGD 25');
  });

  it('skips a stale replay (older/equal created_at)', async () => {
    store.addWatch(-100, { topics: [DEMO_MARKET] });
    const { sent, edited, api } = fakeApi();
    const feed = makeIntentFeed(store, api, instantQueue(), 'https://fp.example');
    feed(ride('SGD 20', undefined, 'ride-1', now()));
    await new Promise((r) => setTimeout(r, 0));
    feed(ride('SGD 20', undefined, 'ride-1', now())); // same created_at → replay
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(1);
    expect(edited).toHaveLength(0);
  });

  it('strikes through the card when a withdrawal tombstone arrives', async () => {
    store.addWatch(-100, { topics: [DEMO_MARKET] });
    const { edited, api } = fakeApi();
    const feed = makeIntentFeed(store, api, instantQueue(), 'https://fp.example');
    feed(ride('SGD 20', undefined, 'ride-1', now()));
    await new Promise((r) => setTimeout(r, 0));
    feed(withdraw('ride-1'));
    await new Promise((r) => setTimeout(r, 0));
    expect(edited).toHaveLength(1);
    expect(edited[0].text).toContain('no longer available');
  });

  it('ignores a withdrawal for a d-tag it never posted', async () => {
    store.addWatch(-100, { topics: [DEMO_MARKET] });
    const { sent, edited, api } = fakeApi();
    makeIntentFeed(store, api, instantQueue(), 'https://fp.example')(withdraw('never-posted'));
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(0);
    expect(edited).toHaveLength(0);
  });

  it('adds a distance line for a near-watch and geotagged intent', async () => {
    store.addWatch(-100, { near: { ...SG, radiusKm: 50 } });
    const { sent, api } = fakeApi();
    const gh = geohashEncode(1.31, 103.85, 6); // ~1-2km from center
    makeIntentFeed(store, api, instantQueue(), 'https://fp.example')(ride('SGD 20', gh));
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/km away/);
  });

  it('persists watches across a reload', () => {
    store.addWatch(-100, { topics: [DEMO_MARKET] }, 5, 'My Group');
    store.setListen(-100, true);
    (store as any).flushNow();
    const reloaded = new GroupStore(path, 60_000);
    const r = reloaded.record(-100)!;
    expect(r.watches[0].filters.topics).toEqual([DEMO_MARKET]);
    expect(r.listen).toBe(true);
    expect(r.title).toBe('My Group');
  });
});
