import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import { geohashEncode } from '@freeport/protocol';
import { GuestStore } from '../src/notify/telegram/guests.js';
import { NegoMap } from '../src/notify/telegram/negomap.js';
import { parseRide, parseWhen, parseCounterReply } from '../src/notify/telegram/conversation.js';
import { GuestRouter } from '../src/notify/telegram/guest.js';

process.setMaxListeners(0);
const PASS = 'test-passphrase-long-enough';
let paths: string[] = [];
const tmp = (name: string) => { const p = join(tmpdir(), `fp-g-${name}-${process.pid}-${Math.random().toString(36).slice(2)}.json`); paths.push(p); return p; };
beforeEach(() => { paths = []; });
afterEach(() => { for (const p of paths) try { rmSync(p); } catch {} });

describe('GuestStore', () => {
  it('round-trips a NIP-49 key and never stores plaintext', () => {
    const store = new GuestStore(tmp('guests'), PASS, 60_000);
    const rec = store.create(42, 555);
    expect(rec.ncryptsec.startsWith('ncryptsec1')).toBe(true);
    const sk = store.decryptKey(rec);
    expect(getPublicKey(sk)).toBe(rec.pubkey); // decrypts back to the same identity
    expect(nip19.decode(store.exportNsec(rec)).type).toBe('nsec');
  });

  it('enforces daily + active-post quotas', () => {
    const store = new GuestStore(tmp('guests'), PASS, 60_000);
    store.create(42, 555);
    expect(store.quotaReason(42, 10, 3)).toBeNull();
    const post = (d: string) => store.addPost(42, { d, eventId: d, market: 'sg-rideshare', schema: 'rideshare/1', title: 't', createdAt: 0, expiresAt: Math.floor(Date.now() / 1000) + 3600, status: 'live', intentJson: '{}' });
    post('a'); post('b'); post('c');
    expect(store.quotaReason(42, 10, 3)).toMatch(/active posts/);   // 3 active
    // Free an active slot but keep daily count → daily gate still counts them.
    store.setPostStatus(42, 'a', 'withdrawn');
    expect(store.quotaReason(42, 3, 3)).toMatch(/Daily limit/);      // 3 posted today
  });

  it('forget leaves a tombstone that preserves the daily count', () => {
    const store = new GuestStore(tmp('guests'), PASS, 60_000);
    store.create(42, 555);
    store.addPost(42, { d: 'a', eventId: 'a', market: 'm', schema: 'rideshare/1', title: 't', createdAt: 0, expiresAt: 9999999999, status: 'live', intentJson: '{}' });
    store.forget(42);
    const rec = store.get(42)!;
    expect(rec.status).toBe('deleted');
    expect(rec.ncryptsec).toBe('');            // key wiped
    expect(rec.postsToday.count).toBe(1);      // quota not reset by delete/recreate
  });
});

describe('NegoMap', () => {
  it('maps a negotiation id to a short sid and back, and records outcomes', () => {
    const m = new NegoMap(tmp('nego'), 60_000);
    const ref = m.ensure('d:pk1:pk2', 42, 555);
    expect(ref.sid.length).toBeLessThanOrEqual(8);
    expect(m.bySid(ref.sid)!.negoId).toBe('d:pk1:pk2');
    expect(m.ensure('d:pk1:pk2', 42, 555).sid).toBe(ref.sid); // idempotent
    m.setOutcome('d:pk1:pk2', 'declined');
    expect(m.byNegoId('d:pk1:pk2')!.outcome).toBe('declined');
  });
});

describe('conversation parsing', () => {
  it('parses /ride with arrow, time and price', () => {
    expect(parseRide('730336 -> Tanjong Pagar at now for 15')).toEqual({ from: '730336', to: 'Tanjong Pagar', when: 'now', payment: '15' });
    expect(parseRide('mcnair to woodlands')).toEqual({ from: 'mcnair', to: 'woodlands', when: undefined, payment: undefined });
    expect(parseRide('no separator here')).toBeNull();
  });
  it('parses when phrases into 30-min windows', () => {
    const base = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(parseWhen('now', base)).toEqual({ start: Math.floor(base / 1000), end: Math.floor(base / 1000) + 1800 });
    const inHalf = parseWhen('in 30m', base);
    expect(inHalf.start).toBe(Math.floor(base / 1000) + 1800);
  });
  it('parses a counter reply as price or time', () => {
    expect(parseCounterReply('60k')).toEqual({ payment: '60k' });
    expect(parseCounterReply('18:45').window).toBeTruthy();
  });
});

// ── GuestRouter conversation flow (agents + geocoder + pool stubbed) ──────────
function fakeApi() {
  const sent: any[] = [];
  return { sent, api: { async sendMessage(chatId: number, text: string, opts: any) { sent.push({ chatId, text, opts }); return { message_id: 1, chat: { id: chatId } }; }, async answerCallbackQuery() {}, async editMessageText() {} } as any };
}
const instantQueue = () => ({ enqueue: (_c: number, task: () => Promise<any>) => task() } as any);
const stubAgents = () => ({ ensureAndRegister: vi.fn(), resolve: vi.fn(() => true), isPending: vi.fn(() => true), sweepIdle: vi.fn(), stop: vi.fn(), graduate: vi.fn() } as any);
const stubGeocoder = () => ({ lookup: async (q: string) => ({ name: q, lat: 1.3, lon: 103.8, geohash: geohashEncode(1.3, 103.8, 6) }) } as any);
const fakePool = () => ({ publish: async () => ({ ok: ['r'], failed: [] }), relays: ['ws://x'] } as any);

function makeRouter() {
  const { api, sent } = fakeApi();
  const guests = new GuestStore(tmp('guests'), PASS, 60_000);
  const negomap = new NegoMap(tmp('nego'), 60_000);
  const agents = stubAgents();
  const router = new GuestRouter({
    api, queue: instantQueue(), negomap, agents, guests, pool: fakePool(), relays: ['ws://x'],
    geocoder: stubGeocoder(), powBits: 1, rideExpiryMin: 120, maxPerDay: 10, maxActive: 3, countryHint: 'sg',
  });
  return { router, sent, guests, agents };
}
const priv = (userId: number, text: string) => ({ message_id: 1, chat: { id: userId, type: 'private' }, from: { id: userId }, text } as any);

describe('GuestRouter', () => {
  it('asks for a contact on first /ride, then posts after it is given', async () => {
    const { router, sent, guests, agents } = makeRouter();
    expect(await router.command(priv(42, '/ride'), 'ride', ['730336', '->', 'Tanjong', 'Pagar'])).toBe(true);
    expect(sent.at(-1).text).toMatch(/how should a driver reach you/i);
    expect(guests.get(42)).toBeUndefined(); // no account until contact given

    await router.freeText(priv(42, '@alice'));
    const g = guests.get(42)!;
    expect(g.contact).toBe('@alice');
    expect(g.posts.length).toBe(1);                 // published
    expect(agents.ensureAndRegister).toHaveBeenCalled();
    expect(sent.at(-1).text).toMatch(/Posted to Freeport/i);
  });

  it('a counter button asks for an amount, then resolves the offer', async () => {
    const { router, agents } = makeRouter();
    await router.callback({ id: 'cq1', from: { id: 42 }, data: 'g:c:sid123', message: { chat: { id: 42, type: 'private' } } } as any);
    await router.freeText(priv(42, '65k'));
    expect(agents.resolve).toHaveBeenCalledWith('sid123', { action: 'counter', terms: { payment: '65k' } });
  });

  it('accept and decline buttons resolve immediately', async () => {
    const { router, agents } = makeRouter();
    await router.callback({ id: 'a', from: { id: 42 }, data: 'g:a:sidA', message: { chat: { id: 42, type: 'private' } } } as any);
    await router.callback({ id: 'b', from: { id: 42 }, data: 'g:d:sidB', message: { chat: { id: 42, type: 'private' } } } as any);
    expect(agents.resolve).toHaveBeenCalledWith('sidA', { action: 'accept' });
    expect(agents.resolve).toHaveBeenCalledWith('sidB', { action: 'decline' });
  });

  it('exportkey requires a typed YES and returns an nsec', async () => {
    const { router, sent, guests } = makeRouter();
    guests.create(42, 42);
    await router.command(priv(42, '/exportkey'), 'exportkey', []);
    expect(sent.at(-1).text).toMatch(/key IS your account/i);
    await router.freeText(priv(42, 'YES'));
    expect(sent.at(-1).text).toMatch(/nsec1/);
    expect(guests.get(42)!.exportedAt).toBeTruthy();
  });

  it('forgetme withdraws and deletes on YES', async () => {
    const { router, guests, agents } = makeRouter();
    guests.create(42, 42);
    await router.command(priv(42, '/forgetme'), 'forgetme', []);
    await router.freeText(priv(42, 'YES'));
    expect(guests.get(42)!.status).toBe('deleted');
    expect(agents.stop).toHaveBeenCalledWith(42);
  });
});
