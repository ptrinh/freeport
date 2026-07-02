/**
 * Telegram bridge wiring. Mounted from http.ts only when TELEGRAM_BOT_TOKEN is
 * set. Adds:
 *  - a content-blind Telegram transport to the notifier (personal DM pings),
 *  - the group-feed intent sink (relay matching intents into watched chats),
 *  - a long-poll getUpdates loop driving the command router,
 *  - HTTP POST /telegram/link + GET /telegram/status for the app's linking flow.
 *
 * Update delivery is long-poll (no public webhook URL required — self-host
 * friendly). One bot, one poll loop, shared with the notifier's SubStore.
 */
import type { Express, RequestHandler } from 'express';
import type { Notifier } from '../routes.js';
import { TelegramApi, GoneError } from './api.js';
import { SendQueue } from './queue.js';
import { LinkCodes } from './linkcodes.js';
import { GroupStore } from './groups.js';
import { makeIntentFeed } from './feed.js';
import { makeCommandRouter } from './commands.js';

export interface TelegramBridge { groups: GroupStore; stop: () => void; botUsername: string }

export async function mountTelegram(
  app: Express,
  notifier: Notifier,
  dataDir: string,
  limiter: RequestHandler,
): Promise<TelegramBridge> {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const webBase = (process.env.TELEGRAM_WEB_BASE ?? 'https://freeport.trinh.uk').replace(/\/$/, '');
  const pollTimeout = Math.max(1, Number(process.env.TELEGRAM_POLL_TIMEOUT_SEC ?? 50));

  const api = new TelegramApi(token);
  const me = await api.getMe();
  const queue = new SendQueue();
  const codes = new LinkCodes();
  const groups = new GroupStore(`${dataDir}/telegram-groups.json`);

  // 1. Personal DM pings: give the watcher a Telegram sender. Content-blind
  //    body; 'gone' prunes the linked record (bot blocked / chat deleted).
  notifier.watcher.setTelegramSender(async (chatId, body) => {
    try {
      await queue.enqueue(chatId, () =>
        api.sendMessage(chatId, `🔔 ${body.body}`, {
          buttons: [[{ text: 'Open Freeport', url: `${webBase}${(body.data?.url as string) ?? '/'}` }]],
          disablePreview: true,
        }),
      );
      return 'ok';
    } catch (e) {
      return e instanceof GoneError ? 'gone' : 'ok'; // transient errors: keep the record
    }
  });

  // 2. Group feed: relay matching intents into watched chats.
  notifier.watcher.setIntentSink(makeIntentFeed(groups, api, queue, webBase));

  // 3. HTTP linking routes (app → bridge).
  app.post('/telegram/link', limiter, (req, res) => {
    const pubkey = typeof req.body?.pubkey === 'string' ? req.body.pubkey.toLowerCase() : '';
    if (!/^[0-9a-f]{64}$/.test(pubkey)) { res.status(400).json({ error: 'valid pubkey (64-hex) required' }); return; }
    const code = codes.create(pubkey);
    res.json({ code, url: `https://t.me/${me.username}?start=${code}`, expiresIn: 600 });
  });
  app.get('/telegram/status', limiter, (req, res) => {
    const pubkey = String(req.query.pubkey ?? '').toLowerCase();
    const linked = notifier.store.all().some((r) => r.telegramChatId && r.pubkey === pubkey);
    res.json({ linked });
  });

  // 4. Long-poll loop.
  const router = makeCommandRouter({ api, subs: notifier.store, watcher: notifier.watcher, groups, codes, queue, botUsername: me.username, webBase });
  let stopped = false;
  let offset = 0;
  let backoff = 1000;
  (async function loop() {
    while (!stopped) {
      try {
        const updates = await api.getUpdates(offset, pollTimeout, ['message', 'channel_post', 'callback_query', 'my_chat_member']);
        backoff = 1000;
        for (const u of updates) {
          offset = u.update_id + 1; // advance BEFORE handling so a bad update can't replay forever
          try { await router(u); } catch (err) { console.error('[telegram] handler error', err); }
        }
      } catch (err) {
        if (stopped) break;
        console.error(`[telegram] poll error (retry in ${backoff}ms)`, err instanceof Error ? err.message : err);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 60000);
      }
    }
  })();

  console.error(`[telegram] bridge up as @${me.username} • ${groups.size()} groups`);
  return { groups, botUsername: me.username, stop: () => { stopped = true; } };
}
