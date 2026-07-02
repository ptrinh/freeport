/**
 * The Telegram transport as seen by the Watcher: a linked (telegramChatId)
 * subscription receives content-blind DM pings, coalesces bursts, is pruned on
 * 'gone', and is never TTL-swept (no app heartbeat to keep it fresh).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn(async () => {}) } }));
vi.mock('expo-server-sdk', () => ({ Expo: class { static isExpoPushToken() { return true; } async sendPushNotificationsAsync() { return [{ status: 'ok' }]; } } }));

import { Watcher } from '../src/notify/watcher.js';
import { SubStore } from '../src/notify/store.js';

process.setMaxListeners(0);
const flush = () => new Promise((r) => setTimeout(r, 0));
const dm = (recipient: string, id: string) => ({ kind: 4, tags: [['p', recipient]], content: 'ct', id, pubkey: 'sender', created_at: 0, sig: '' } as any);

let store: SubStore, watcher: Watcher, path: string;
beforeEach(() => {
  path = join(tmpdir(), `fp-tg-dm-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  store = new SubStore(path, 60_000);
  watcher = new Watcher(['ws://fake'], store);
  (watcher as any).pool = { subscribeMany: () => ({ close() {} }), close() {} };
});
afterEach(() => { watcher.close(); try { rmSync(path); } catch {} });

describe('Watcher telegram transport', () => {
  const ME = 'f'.repeat(64);

  it('pings a linked Telegram chat on a DM to its pubkey', async () => {
    const sends: any[] = [];
    watcher.setTelegramSender(async (chatId, body) => { sends.push({ chatId, body }); return 'ok'; });
    store.upsertTelegram(555, {}, ME);
    await (watcher as any).onDM(dm(ME, 'ev1'));
    await flush();
    expect(sends).toHaveLength(1);
    expect(sends[0].chatId).toBe(555);
    expect(sends[0].body.body).toBe('New message');
  });

  it('coalesces a burst of DMs to one ping within the cooldown', async () => {
    const sends: any[] = [];
    watcher.setTelegramSender(async () => { sends.push(1); return 'ok'; });
    store.upsertTelegram(555, {}, ME);
    await (watcher as any).onDM(dm(ME, 'ev1'));
    await (watcher as any).onDM(dm(ME, 'ev2'));
    await flush();
    expect(sends).toHaveLength(1);
  });

  it("prunes the record when the sender reports 'gone'", async () => {
    watcher.setTelegramSender(async () => 'gone');
    store.upsertTelegram(555, {}, ME);
    expect(store.size()).toBe(1);
    await (watcher as any).onDM(dm(ME, 'ev1'));
    await flush();
    expect(store.size()).toBe(0);
  });

  it('never TTL-sweeps a telegram record (no heartbeat)', () => {
    store.upsertTelegram(555, {}, ME);
    expect(store.sweepStale(0)).toBe(0);   // 0ms cutoff would evict any heartbeat-based record
    expect(store.size()).toBe(1);
  });

  it('does nothing when no telegram sender is set (bridge off)', async () => {
    store.upsertTelegram(555, {}, ME);
    await (watcher as any).onDM(dm(ME, 'ev1'));
    await flush();
    expect(store.size()).toBe(1); // not pruned, not crashed
  });
});
