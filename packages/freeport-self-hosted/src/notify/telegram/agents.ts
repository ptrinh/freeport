/**
 * GuestAgentManager — one FreeportAgent per active guest, all sharing a single
 * relay pool. The agent handles the negotiation state machine; we supply a
 * `decideOffer` callback that renders each inbound offer as a Telegram card and
 * blocks until the guest taps Accept / Counter / Decline (or it times out).
 *
 * Restart-safe: on boot we re-start agents for guests with live posts and
 * re-register those intents so backfilled offers reopen correctly. Terminal
 * outcomes are recorded in the negomap so a replayed offer isn't re-carded.
 */
import { SimplePool } from 'nostr-tools/pool';
import { FreeportAgent, Transport, type AgentEvents, type OfferDecision } from '@freeport/agent';
import type { Intent, Negotiation, ProposedTerms } from '@freeport/protocol';
import type { RelayPool } from '../../pool.js';
import { fetchReputationSummary } from '../../reputation.js';
import type { TelegramApi } from './api.js';
import type { SendQueue } from './queue.js';
import type { GuestStore, GuestRecord } from './guests.js';
import type { NegoMap } from './negomap.js';
import { offerCard, resolvedCard, dealCard } from './cards.js';

export interface GuestAgentDeps {
  relays: string[];
  reputationPool: RelayPool; // MCP pool for karma/receipt queries
  guests: GuestStore;
  negomap: NegoMap;
  api: TelegramApi;
  queue: SendQueue;
  offerTimeoutMs: number;
}

interface Live { agent: FreeportAgent; transport: Transport }

export class GuestAgentManager {
  private readonly pool = new SimplePool(); // shared by every guest Transport
  private readonly live = new Map<number, Live>();
  /** sid → resolver for the card the guest is currently deciding. */
  private readonly pending = new Map<string, (d: OfferDecision) => void>();

  constructor(private readonly deps: GuestAgentDeps) {}

  /** Start agents for every active guest that still has a live post. */
  restoreAll(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const g of this.deps.guests.all()) {
      if (g.status !== 'active') continue;
      if (g.posts.some((p) => p.status === 'live' && p.expiresAt > now)) this.ensure(g);
    }
  }

  /** Ensure a guest's agent is running (idempotent). */
  ensure(guest: GuestRecord): void {
    if (this.live.has(guest.telegramUserId) || guest.status !== 'active') return;
    const sk = this.deps.guests.decryptKey(guest);
    const transport = new Transport(sk, this.deps.relays, this.pool); // shared pool
    sk.fill(0);
    const events: AgentEvents = {
      onLog: () => {},
      confirmDeal: async () => true, // unused (decideOffer drives everything)
      onDeal: (nego) => this.onDeal(guest, nego),
      decideOffer: (nego) => this.decideOffer(guest, nego),
    };
    const agent = new FreeportAgent(transport, { name: `guest:${guest.telegramUserId}`, relays: this.deps.relays, markets: [], rules: [], contact: guest.contact }, events);
    // Re-register live intents so inbound offers open against them.
    const now = Math.floor(Date.now() / 1000);
    for (const p of guest.posts) {
      if (p.status !== 'live' || p.expiresAt <= now) continue;
      try { agent.registerPublishedIntent(JSON.parse(p.intentJson) as Intent); } catch { /* skip corrupt */ }
    }
    agent.start();
    this.live.set(guest.telegramUserId, { agent, transport });
  }

  /** Called after a successful post so the agent (and its subscription) is live. */
  ensureAndRegister(guest: GuestRecord, intent: Intent): void {
    this.ensure(guest);
    this.live.get(guest.telegramUserId)?.agent.registerPublishedIntent(intent);
  }

  stop(userId: number): void {
    const l = this.live.get(userId);
    if (!l) return;
    l.agent.stop(); l.transport.close(); // shared pool stays open (Transport doesn't own it)
    this.live.delete(userId);
  }

  /** Stop agents whose posts have all expired (called periodically). */
  sweepIdle(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const userId of [...this.live.keys()]) {
      const g = this.deps.guests.get(userId);
      if (!g || g.status !== 'active' || !g.posts.some((p) => p.status === 'live' && p.expiresAt > now)) this.stop(userId);
    }
  }

  /** A guest graduated to the app — stop acting for them. */
  graduate(userId: number): void {
    this.stop(userId);
    this.deps.guests.markGraduated(userId);
  }

  // ── offer decision plumbing ───────────────────────────────────────────────

  private async decideOffer(guest: GuestRecord, nego: Negotiation): Promise<OfferDecision> {
    if (guest.status !== 'active') return { action: 'decline', reason: 'inactive' };
    const ref = this.deps.negomap.ensure(nego.id, guest.telegramUserId, guest.chatId);
    if (ref.outcome) return { action: 'decline', reason: 'already resolved' }; // don't re-card on replay

    const rep = await fetchReputationSummary(this.deps.reputationPool, this.deps.relays, nego.peer).catch(() => null);
    const card = offerCard(nego, rep, ref.sid);
    try {
      const sent = await this.deps.queue.enqueue(guest.chatId, () =>
        this.deps.api.sendMessage(guest.chatId, card.text, { parseMode: 'HTML', buttons: card.buttons, disablePreview: true }));
      this.deps.negomap.setMessageId(ref.sid, sent.message_id);
    } catch { return { action: 'decline', reason: 'card send failed' }; }

    return new Promise<OfferDecision>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(ref.sid)) return;
        this.pending.delete(ref.sid);
        this.deps.negomap.setOutcome(nego.id, 'declined');
        this.editCard(ref.sid, resolvedCard(nego, 'expired'));
        resolve({ action: 'decline', reason: 'timeout' });
      }, this.deps.offerTimeoutMs);
      timer.unref?.();
      this.pending.set(ref.sid, (d) => { clearTimeout(timer); this.pending.delete(ref.sid); resolve(d); });
    });
  }

  /** Resolve a pending offer from a button tap / counter reply. Returns false if
   *  the sid is unknown or already resolved. */
  resolve(sid: string, decision: OfferDecision): boolean {
    const r = this.pending.get(sid);
    if (!r) return false;
    const ref = this.deps.negomap.bySid(sid);
    if (ref) this.deps.negomap.setOutcome(ref.negoId, decision.action === 'counter' ? 'countered' : decision.action === 'accept' ? 'accepted' : 'declined');
    r(decision);
    return true;
  }

  /** True while a card is awaiting the guest's decision (for callback validation). */
  isPending(sid: string): boolean { return this.pending.has(sid); }

  private onDeal(guest: GuestRecord, nego: Negotiation): void {
    const ref = this.deps.negomap.byNegoId(nego.id);
    if (ref) { this.deps.negomap.setOutcome(nego.id, 'confirmed'); this.editCard(ref.sid, resolvedCard(nego, 'confirmed')); }
    this.deps.guests.setPostStatus(guest.telegramUserId, nego.intent.d, 'dealt');
    this.deps.queue.enqueue(guest.chatId, () => this.deps.api.sendMessage(guest.chatId, dealCard(nego), { parseMode: 'HTML', disablePreview: true })).catch(() => {});
  }

  private editCard(sid: string, text: string): void {
    const ref = this.deps.negomap.bySid(sid);
    if (!ref?.messageId) return;
    this.deps.queue.enqueue(ref.chatId, () => this.deps.api.editMessageText(ref.chatId, ref.messageId!, text, { parseMode: 'HTML' })).catch(() => {});
  }
}

export type { OfferDecision, ProposedTerms };
