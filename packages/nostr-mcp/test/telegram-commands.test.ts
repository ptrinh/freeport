import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { SubStore } from '../src/notify/store.js';
import { GroupStore } from '../src/notify/telegram/groups.js';
import { LinkCodes } from '../src/notify/telegram/linkcodes.js';
import { SendQueue } from '../src/notify/telegram/queue.js';
import { makeCommandRouter } from '../src/notify/telegram/commands.js';

process.setMaxListeners(0);

function fakeApi(memberStatus: Record<number, string> = {}) {
  const sent: any[] = [];
  return {
    sent,
    api: {
      async sendMessage(chatId: number, text: string, opts: any) { sent.push({ chatId, text, opts }); return { message_id: 1, chat: { id: chatId } }; },
      async getChatMember(_chatId: number, userId: number) { return { status: memberStatus[userId] ?? 'member' }; },
    } as any,
  };
}
const stubWatcher = () => { let n = 0; return { refresh: () => { n++; }, refreshed: () => n } as any; };
const instantQueue = () => new SendQueue((_ms) => Promise.resolve(), () => 0);
const msg = (over: any) => ({ update_id: 1, message: { message_id: 9, chat: { id: over.chatId, type: over.type }, from: over.from, text: over.text } });

let subPath: string, grpPath: string, subs: SubStore, groups: GroupStore;
beforeEach(() => {
  const uniq = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  subPath = join(tmpdir(), `fp-tg-subs-${uniq}.json`); grpPath = join(tmpdir(), `fp-tg-grp-${uniq}.json`);
  subs = new SubStore(subPath, 60_000); groups = new GroupStore(grpPath, 60_000);
});
afterEach(() => { for (const p of [subPath, grpPath]) try { rmSync(p); } catch {} });

function router(over: Partial<Parameters<typeof makeCommandRouter>[0]> = {}) {
  const { api } = over.api ? { api: over.api } : fakeApi();
  return makeCommandRouter({
    api: (over.api as any) ?? api, subs, watcher: over.watcher ?? stubWatcher(), groups,
    codes: over.codes ?? new LinkCodes(), queue: instantQueue(), botUsername: 'FreeportBot', webBase: 'https://fp.example',
  });
}

describe('private linking commands', () => {
  it('/start <code> links the chat to the pubkey and refreshes the watcher', async () => {
    const codes = new LinkCodes();
    const pk = 'a'.repeat(64);
    const code = codes.create(pk);
    const watcher = stubWatcher();
    const { api } = fakeApi();
    const handle = router({ api, codes, watcher });
    await handle(msg({ chatId: 555, type: 'private', from: { id: 555 }, text: `/start ${code}` }));
    const rec = subs.all().find((r) => r.telegramChatId === 555);
    expect(rec?.pubkey).toBe(pk);
    expect(watcher.refreshed()).toBeGreaterThan(0);
  });

  it('/start with a bad code links nothing', async () => {
    await router()(msg({ chatId: 555, type: 'private', from: { id: 555 }, text: '/start nope' }));
    expect(subs.all().some((r) => r.telegramChatId === 555)).toBe(false);
  });

  it('/stop unlinks', async () => {
    subs.upsertTelegram(555, {}, 'a'.repeat(64));
    await router()(msg({ chatId: 555, type: 'private', from: { id: 555 }, text: '/stop' }));
    expect(subs.all().some((r) => r.telegramChatId === 555)).toBe(false);
  });
});

describe('group feed commands + admin gate', () => {
  it('an admin can /watch; the watch is stored', async () => {
    const { api } = fakeApi({ 42: 'administrator' });
    await router({ api })(msg({ chatId: -100, type: 'supergroup', from: { id: 42 }, text: '/watch@FreeportBot sg-rideshare' }));
    expect(groups.record(-100)?.watches[0].filters.topics).toEqual(['sg-rideshare']);
  });

  it('a non-admin cannot /watch', async () => {
    const { api, sent } = fakeApi({ 42: 'member' });
    await router({ api })(msg({ chatId: -100, type: 'supergroup', from: { id: 42 }, text: '/watch sg-rideshare' }));
    expect(groups.record(-100)?.watches ?? []).toHaveLength(0);
    expect(sent.some((s) => /admins/.test(s.text))).toBe(true);
  });

  it('/near parses a geohash + radius', async () => {
    const { api } = fakeApi({ 42: 'creator' });
    await router({ api })(msg({ chatId: -100, type: 'supergroup', from: { id: 42 }, text: '/near w21z9 10' }));
    const near = groups.record(-100)?.watches[0].filters.near;
    expect(near?.radiusKm).toBe(10);
    expect(typeof near?.lat).toBe('number');
  });

  it('ignores a command addressed to another bot', async () => {
    const { api } = fakeApi({ 42: 'administrator' });
    await router({ api })(msg({ chatId: -100, type: 'supergroup', from: { id: 42 }, text: '/watch@OtherBot sg-rideshare' }));
    expect(groups.record(-100)?.watches ?? []).toHaveLength(0);
  });

  it('listen mode offers a broadcast button on a hitcher post', async () => {
    groups.setListen(-100, true);
    const { api, sent } = fakeApi();
    await router({ api })(msg({ chatId: -100, type: 'supergroup', from: { id: 7 }, text: 'Pick up: 730336\nDrop off: Tanjong Pagar\nTime: now\nPax: 1' }));
    expect(sent).toHaveLength(1);
    expect(sent[0].opts.buttons[0][0].url).toContain('tab=post');
    expect(sent[0].opts.buttons[0][0].url).toContain('from=730336');
  });

  it('listen mode ignores a non-ride message', async () => {
    groups.setListen(-100, true);
    const { api, sent } = fakeApi();
    await router({ api })(msg({ chatId: -100, type: 'supergroup', from: { id: 7 }, text: 'thanks everyone!' }));
    expect(sent).toHaveLength(0);
  });

  it('removes a group when the bot is kicked', async () => {
    groups.addWatch(-100, { topics: ['sg-rideshare'] });
    await router()({ update_id: 2, my_chat_member: { chat: { id: -100, type: 'supergroup' }, new_chat_member: { status: 'kicked' } } } as any);
    expect(groups.record(-100)).toBeUndefined();
  });
});
