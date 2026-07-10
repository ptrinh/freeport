/**
 * Telegram update router: bot commands + organic-post listening.
 *
 * Private chat:  /start <code> (link a pubkey), /stop (unlink), /status
 * Group/channel: /watch <topic>, /near <geohash|lat,lon> <km>, /unwatch <topic|all>,
 *                /listen on|off, /status — all admin-gated.
 * Listen mode:   a non-command group post matching the hitcher template gets a
 *                one-tap "broadcast to Freeport" reply.
 */
import { geohashDecode } from '@freeport/protocol';
import type { SubStore, SubFilters } from '../store.js';
import type { Watcher } from '../watcher.js';
import type { GroupStore } from './groups.js';
import type { LinkCodes } from './linkcodes.js';
import type { SendQueue } from './queue.js';
import type { TelegramApi, TgUpdate, TgMessage } from './api.js';
import { parseHitch, broadcastUrl } from './listen.js';
import type { GuestRouter } from './guest.js';

const GROUP_ANON_BOT = 1087968824; // Telegram's anonymous-admin sender id

export interface RouterDeps {
  api: TelegramApi;
  subs: SubStore;
  watcher: Watcher;
  groups: GroupStore;
  codes: LinkCodes;
  queue: SendQueue;
  botUsername: string;
  webBase: string;
  /** Present only when guest mode is enabled (TELEGRAM_GUEST_KEY_PASSPHRASE set). */
  guest?: GuestRouter;
}

export function makeCommandRouter(deps: RouterDeps) {
  const { api, subs, watcher, groups, codes, queue, botUsername, webBase, guest } = deps;
  const adminCache = new Map<string, { ok: boolean; at: number }>(); // `${chat}:${user}` → 5-min cache
  const reply = (chatId: number, text: string, replyTo?: number) =>
    queue.enqueue(chatId, () => api.sendMessage(chatId, text, { parseMode: 'HTML', disablePreview: true, replyToMessageId: replyTo })).catch(() => {});

  async function isAdmin(chatId: number, userId?: number): Promise<boolean> {
    if (!userId || userId === GROUP_ANON_BOT) return true; // channel post / anonymous admin
    const key = `${chatId}:${userId}`;
    const cached = adminCache.get(key);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.ok;
    let ok = false;
    try { ok = ['creator', 'administrator'].includes((await api.getChatMember(chatId, userId)).status); } catch { ok = false; }
    adminCache.set(key, { ok, at: Date.now() });
    return ok;
  }

  /** "/cmd@Bot arg1 arg2" → { cmd, args } (only when it targets us or is unqualified). */
  function parseCommand(text: string): { cmd: string; args: string[] } | null {
    const m = /^\/([a-z_]+)(@(\S+))?(?:\s+([\s\S]+))?$/i.exec(text.trim());
    if (!m) return null;
    if (m[3] && m[3].toLowerCase() !== botUsername.toLowerCase()) return null; // @other_bot
    return { cmd: m[1].toLowerCase(), args: (m[4] ?? '').split(/\s+/).filter(Boolean) };
  }

  function nearFromArgs(args: string[]): SubFilters['near'] | null {
    // "/near <geohash> <km>" or "/near <lat,lon> <km>" or "/near <lat> <lon> <km>"
    const km = Number(args[args.length - 1]);
    if (!Number.isFinite(km) || km <= 0) return null;
    const rest = args.slice(0, -1).join(' ').trim();
    const ll = rest.match(/^(-?\d+(?:\.\d+)?)\s*,?\s*(-?\d+(?:\.\d+)?)$/);
    if (ll) return { lat: Number(ll[1]), lon: Number(ll[2]), radiusKm: km };
    try { const c = geohashDecode(rest); return { lat: c.lat, lon: c.lon, radiusKm: km }; } catch { return null; }
  }

  async function handlePrivate(msg: TgMessage, cmd: string, args: string[]): Promise<void> {
    // Guest-mode commands (/ride, /myposts, /exportkey, …) take precedence when
    // guest mode is on; linking commands below still work for app users.
    if (guest && await guest.command(msg, cmd, args)) return;
    if (cmd === 'start') {
      const pubkey = args[0] ? codes.consume(args[0]) : null;
      if (!pubkey) { reply(msg.chat.id, '⚠️ That link expired or was already used. Open the app and tap “Link Telegram” again.'); return; }
      subs.upsertTelegram(msg.chat.id, {}, pubkey);
      watcher.refresh();
      reply(msg.chat.id, '✅ Linked. You’ll get a ping here when there’s new activity on your Freeport deals. Send /stop to unlink.');
    } else if (cmd === 'stop') {
      const removed = subs.removeByTelegramChat(msg.chat.id);
      watcher.refresh();
      reply(msg.chat.id, removed ? '🔕 Unlinked. No more pings here.' : 'You weren’t linked.');
    } else if (cmd === 'status') {
      reply(msg.chat.id, 'Freeport bot. Link from the app to get activity pings here; add me to a group and use /watch to relay the market feed.');
    } else {
      reply(msg.chat.id, 'Commands: /start <code> (from the app), /stop, /status.');
    }
  }

  async function handleGroup(msg: TgMessage, cmd: string, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const gate = async () => {
      if (await isAdmin(chatId, msg.from?.id)) return true;
      reply(chatId, '🔒 Only group admins can change the Freeport feed.', msg.message_id);
      return false;
    };
    if (cmd === 'watch') {
      if (!args[0]) { reply(chatId, 'Usage: /watch &lt;market-or-topic&gt;  e.g. /watch sg-rideshare', msg.message_id); return; }
      if (!(await gate())) return;
      groups.addWatch(chatId, { topics: [args[0]] }, msg.from?.id, msg.chat.title);
      reply(chatId, `📡 Watching <b>${args[0]}</b>. New matching posts will appear here.`, msg.message_id);
    } else if (cmd === 'near') {
      const near = nearFromArgs(args);
      if (!near) { reply(chatId, 'Usage: /near &lt;geohash|lat,lon&gt; &lt;radiusKm&gt;  e.g. /near w21z 10', msg.message_id); return; }
      if (!(await gate())) return;
      groups.addWatch(chatId, { near }, msg.from?.id, msg.chat.title);
      reply(chatId, `📍 Watching within ${near.radiusKm} km. New nearby posts will appear here.`, msg.message_id);
    } else if (cmd === 'unwatch') {
      if (!(await gate())) return;
      const n = groups.removeWatch(chatId, args[0] || 'all');
      reply(chatId, n ? `Removed ${n} watch(es).` : 'No matching watch.', msg.message_id);
    } else if (cmd === 'listen') {
      if (!(await gate())) return;
      const on = (args[0] || '').toLowerCase() === 'on';
      groups.setListen(chatId, on, msg.chat.title);
      reply(chatId, on
        ? '👂 Listen mode ON — I’ll offer a “broadcast to Freeport” button on ride posts here.'
        : '🙈 Listen mode OFF.', msg.message_id);
    } else if (cmd === 'status') {
      const r = groups.record(chatId);
      const watches = r?.watches.map((w) => w.filters.topics?.join(',') ?? (w.filters.near ? `${w.filters.near.radiusKm}km radius` : '?')).join('; ') || 'none';
      reply(chatId, `Watches: ${watches}\nListen mode: ${r?.listen ? 'on' : 'off'}`, msg.message_id);
    }
  }

  /** Organic (non-command) group post → offer a broadcast button if listen is on. */
  function handleListen(msg: TgMessage): void {
    const r = groups.record(msg.chat.id);
    if (!r?.listen || !msg.text) return;
    const hitch = parseHitch(msg.text);
    if (!hitch) return;
    queue.enqueue(msg.chat.id, () => api.sendMessage(
      msg.chat.id,
      '📡 Reach drivers beyond this group — broadcast this on Freeport:',
      { replyToMessageId: msg.message_id, buttons: [[{ text: '🚗 Broadcast to Freeport', url: broadcastUrl(webBase, hitch) }]] },
    )).catch(() => {});
  }

  return async function handleUpdate(u: TgUpdate): Promise<void> {
    if (u.callback_query) { if (guest) await guest.callback(u.callback_query); return; }
    if (u.my_chat_member) {
      const status = u.my_chat_member.new_chat_member.status;
      if (status === 'left' || status === 'kicked') groups.removeChat(u.my_chat_member.chat.id);
      return;
    }
    const msg = u.message ?? u.channel_post;
    if (!msg) return;
    const isPrivate = msg.chat.type === 'private';
    const parsed = msg.text ? parseCommand(msg.text) : null;
    if (parsed) {
      if (isPrivate) await handlePrivate(msg, parsed.cmd, parsed.args);
      else await handleGroup(msg, parsed.cmd, parsed.args);
    } else if (isPrivate) {
      // Free text in a private chat drives the guest conversation (contact,
      // counter amount, export/forget confirmation).
      if (guest) await guest.freeText(msg);
    } else {
      handleListen(msg);
    }
  };
}
