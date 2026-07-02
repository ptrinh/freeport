/**
 * Group feed: the intent sink. For each ingested intent, find every group whose
 * watches match and post (or edit) a card there. Collapses per (chat, intent
 * d-tag) so a replaceable-event edit or a withdrawal updates the existing
 * message instead of double-posting — and, because `posted` is persisted, the
 * watcher's 60s re-subscribe overlap can't repost on restart.
 */
import type { Event } from 'nostr-tools';
import { parseIntentEvent } from '@freeport/protocol';
import { matches } from '../match.js';
import type { GroupStore } from './groups.js';
import type { SendQueue } from './queue.js';
import type { TelegramApi } from './api.js';
import { GoneError } from './api.js';
import { intentCard, withdrawnCard } from './format.js';

export function makeIntentFeed(store: GroupStore, api: TelegramApi, queue: SendQueue, webBase: string) {
  return (ev: Event, geohash?: string): void => {
    const intent = parseIntentEvent(ev);
    if (!intent) return;
    const d = intent.d;
    const now = Math.floor(Date.now() / 1000);
    const withdrawn = !intent.content.payload || Object.keys(intent.content.payload as object).length === 0;
    if (!withdrawn && intent.content.expires_at <= now) return; // already expired — don't post

    for (const group of store.all()) {
      // First matching watch decides whether this chat sees the intent (and,
      // for the distance line, which radius center to measure from).
      const hit = group.watches.find((w) => matches(ev, w.filters, geohash));
      if (!hit) continue;
      const prior = group.posted[d];

      if (withdrawn) {
        if (!prior) continue; // nothing posted for this d here — ignore the tombstone
        queue.enqueue(group.chatId, () =>
          api.editMessageText(group.chatId, prior.messageId, withdrawnCard(intent.content.title || ''), { parseMode: 'HTML' }),
        ).catch(() => { /* best-effort */ });
        continue;
      }

      // Stale replay (older or same version already posted) → skip.
      if (prior && ev.created_at <= prior.createdAt) continue;

      const card = intentCard(ev, webBase, hit.filters.near);
      if (!card) continue;
      const opts = { parseMode: 'HTML' as const, buttons: [[card.button]], disablePreview: true };

      if (prior) {
        queue.enqueue(group.chatId, async () => {
          await api.editMessageText(group.chatId, prior.messageId, card.text, opts);
          store.setPosted(group.chatId, d, { messageId: prior.messageId, createdAt: ev.created_at, expiresAt: intent.content.expires_at });
        }).catch(() => {});
      } else {
        queue.enqueue(group.chatId, async () => {
          const sent = await api.sendMessage(group.chatId, card.text, opts);
          store.setPosted(group.chatId, d, { messageId: sent.message_id, createdAt: ev.created_at, expiresAt: intent.content.expires_at });
        }).catch((e) => {
          if (e instanceof GoneError) store.removeChat(group.chatId); // bot removed from the group
        });
      }
    }
  };
}
