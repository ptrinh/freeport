/**
 * Guest-mode conversation handler: posting a ride from Telegram, and the inline
 * Accept / Counter / Decline flow on incoming offers. Holds per-chat
 * conversation state (in-memory) and delegates negotiation to the guest's
 * FreeportAgent via GuestAgentManager.
 */
import type { TelegramApi, TgMessage, TgCallbackQuery } from './api.js';
import type { SendQueue } from './queue.js';
import type { GuestStore } from './guests.js';
import type { NegoMap } from './negomap.js';
import type { Geocoder } from './geocode.js';
import { GuestAgentManager } from './agents.js';
import { publishGuestRide, withdrawGuestPost, type PublishDeps } from './postflow.js';
import { parseRide, parseCounterReply, type ConvState, type RideDraft } from './conversation.js';
import { receiptCard } from './cards.js';

export interface GuestDeps extends PublishDeps {
  api: TelegramApi;
  queue: SendQueue;
  negomap: NegoMap;
  agents: GuestAgentManager;
  geocoder: Geocoder;
  countryHint?: string;
}

const EXPORT_WARNING =
  '⚠️ Your key IS your account — anyone with it can act as you, and Telegram chats are not end-to-end encrypted. ' +
  'Import it into the Freeport app, then delete that message. Reply <b>YES</b> to receive it, or /cancel.';

export class GuestRouter {
  private state = new Map<number, ConvState>(); // chatId → conversation state

  constructor(private readonly deps: GuestDeps) {}

  private reply(chatId: number, text: string, buttons?: any) {
    return this.deps.queue.enqueue(chatId, () => this.deps.api.sendMessage(chatId, text, { parseMode: 'HTML', disablePreview: true, ...(buttons ? { buttons } : {}) })).catch(() => {});
  }

  /** A private-chat command. Returns true if handled (so the generic router skips it). */
  async command(msg: TgMessage, cmd: string, args: string[]): Promise<boolean> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id ?? chatId;
    switch (cmd) {
      case 'ride': {
        const draft = parseRide(args.join(' '));
        if (!draft) { this.reply(chatId, 'Post a ride: <code>/ride &lt;from&gt; -&gt; &lt;to&gt; [at &lt;time&gt;] [for &lt;price&gt;]</code>\ne.g. <code>/ride 730336 -&gt; Tanjong Pagar at now for 15</code>'); return true; }
        const guest = this.deps.guests.get(userId);
        if (!guest?.contact) { this.state.set(chatId, { kind: 'awaiting_contact', draft }); this.reply(chatId, 'First, how should a driver reach you once you agree? Reply with your @username or a phone number (shared only with the driver you accept).'); return true; }
        await this.post(chatId, userId, draft);
        return true;
      }
      case 'service':
        this.reply(chatId, 'Posting services from Telegram is coming soon — for now use the Freeport app. /ride works here today.');
        return true;
      case 'myposts': {
        const g = this.deps.guests.get(userId);
        const live = g ? this.deps.guests.activePosts(g) : [];
        this.reply(chatId, live.length ? 'Your live posts:\n' + live.map((p, i) => `${i + 1}. ${p.title}`).join('\n') + '\n\n/cancelpost to withdraw them.' : 'No live posts. /ride to post one.');
        return true;
      }
      case 'cancelpost': {
        const g = this.deps.guests.get(userId);
        const live = g ? this.deps.guests.activePosts(g) : [];
        if (!g || !live.length) { this.reply(chatId, 'Nothing to cancel.'); return true; }
        for (const p of live) await withdrawGuestPost(this.deps, g, p.d);
        this.deps.agents.sweepIdle();
        this.reply(chatId, `Withdrew ${live.length} post(s).`);
        return true;
      }
      case 'exportkey': {
        if (!this.deps.guests.get(userId)) { this.reply(chatId, 'You have no guest account yet — post a ride first.'); return true; }
        this.state.set(chatId, { kind: 'confirm_export' });
        this.reply(chatId, EXPORT_WARNING);
        return true;
      }
      case 'forgetme': {
        this.state.set(chatId, { kind: 'confirm_forget' });
        this.reply(chatId, 'This deletes your guest account and withdraws your live posts. Reply <b>YES</b> to confirm, or /cancel.');
        return true;
      }
      case 'cancel':
        this.state.delete(chatId);
        this.reply(chatId, 'Okay, cancelled.');
        return true;
      case 'help':
        this.reply(chatId, 'Guest commands:\n/ride from -&gt; to [at time] [for price]\n/myposts, /cancelpost\n/exportkey (move to the app), /forgetme');
        return true;
      default:
        return false;
    }
  }

  /** Free text in a private chat, interpreted by the current conversation state. */
  async freeText(msg: TgMessage): Promise<boolean> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id ?? chatId;
    const st = this.state.get(chatId);
    if (!st || st.kind === 'idle') return false;
    const text = (msg.text ?? '').trim();

    if (st.kind === 'awaiting_contact') {
      if (!text) { this.reply(chatId, 'Please send a contact (e.g. @yourhandle).'); return true; }
      const guest = this.deps.guests.get(userId) ?? this.deps.guests.create(userId, chatId);
      this.deps.guests.setContact(userId, text);
      this.state.delete(chatId);
      await this.post(chatId, userId, st.draft, guest.telegramUserId === userId);
      return true;
    }
    if (st.kind === 'counter_amount') {
      const terms = parseCounterReply(text);
      const ok = this.deps.agents.resolve(st.sid, { action: 'counter', terms });
      this.state.delete(chatId);
      this.reply(chatId, ok ? 'Counter sent — I’ll ping you on their reply.' : 'That offer is no longer open.');
      return true;
    }
    if (st.kind === 'confirm_export') {
      this.state.delete(chatId);
      if (text.toUpperCase() !== 'YES') { this.reply(chatId, 'Export cancelled.'); return true; }
      const g = this.deps.guests.get(userId);
      if (!g) { this.reply(chatId, 'No account to export.'); return true; }
      const nsec = this.deps.guests.exportNsec(g);
      this.deps.guests.markExported(userId);
      this.reply(chatId, `Here is your key. Import it into the Freeport app, then delete this message:\n<code>${nsec}</code>`, [[{ text: '✅ Imported — the app takes over', callback_data: `g:grad:${userId}` }]]);
      return true;
    }
    if (st.kind === 'confirm_forget') {
      this.state.delete(chatId);
      if (text.toUpperCase() !== 'YES') { this.reply(chatId, 'Cancelled.'); return true; }
      const g = this.deps.guests.get(userId);
      if (g) { for (const p of this.deps.guests.activePosts(g)) await withdrawGuestPost(this.deps, g, p.d); }
      this.deps.agents.stop(userId);
      this.deps.guests.forget(userId);
      this.reply(chatId, 'Your guest account and posts are gone. 👋');
      return true;
    }
    return false;
  }

  /** An inline-button tap on an offer card. */
  async callback(cq: TgCallbackQuery): Promise<void> {
    const data = cq.data ?? '';
    const [, action, arg] = data.split(':'); // g:<action>:<sid|userId>
    const chatId = cq.message?.chat.id ?? cq.from.id;
    await this.deps.api.answerCallbackQuery(cq.id).catch(() => {});
    if (action === 'grad') { this.deps.agents.graduate(Number(arg)); this.reply(chatId, 'Done — the app now manages your deals here on out.'); return; }
    if (action === 'a') { if (!this.deps.agents.resolve(arg, { action: 'accept' })) this.reply(chatId, 'That offer is no longer open.'); return; }
    if (action === 'd') { if (!this.deps.agents.resolve(arg, { action: 'decline' })) this.reply(chatId, 'That offer is no longer open.'); return; }
    if (action === 'c') {
      if (!this.deps.agents.isPending(arg)) { this.reply(chatId, 'That offer is no longer open.'); return; }
      this.state.set(chatId, { kind: 'counter_amount', sid: arg });
      this.reply(chatId, 'Reply with your counter — a price (e.g. <code>60k</code>) or a time (e.g. <code>18:45</code>).');
    }
  }

  private async post(chatId: number, userId: number, draft: RideDraft, _known = false): Promise<void> {
    const guest = this.deps.guests.get(userId);
    if (!guest) { this.reply(chatId, 'Something went wrong — try /ride again.'); return; }
    const [from, to] = await Promise.all([
      this.deps.geocoder.lookup(draft.from, this.deps.countryHint),
      this.deps.geocoder.lookup(draft.to, this.deps.countryHint),
    ]);
    if (!from) { this.reply(chatId, `Couldn’t find “${draft.from}”. Try a more specific address or a postal code.`); return; }
    if (!to) { this.reply(chatId, `Couldn’t find “${draft.to}”. Try a more specific address or a postal code.`); return; }
    const res = await publishGuestRide(this.deps, guest, draft, from, to);
    if (!res.ok) { this.reply(chatId, `⚠️ ${res.error}`); return; }
    this.deps.agents.ensureAndRegister(guest, res.intent);
    this.reply(chatId, receiptCard(res.intent.content.title, this.deps.rideExpiryMin * 60));
  }
}
