/**
 * Thin Nostr client for the app: subscribe to a market, post intents,
 * track negotiations. Mirrors packages/agent/src/transport.ts but with
 * React-state-friendly callbacks (React Native has WebSocket built in).
 */
import { SimplePool } from 'nostr-tools/pool';
import { type Event } from 'nostr-tools/pure';
import { getPow } from 'nostr-tools/nip13';
import { minePowAsync } from './pow';
import { screenIntent, screenIntentContent } from './moderation';
import { publishProfile, maskPhone, type UserProfile } from './profile';
import { publishKarma, type KarmaScore } from './karma';
import { publishReceipt } from './receipts';
import { fetchReputation, type Reputation } from './reputation';
import { buildTrustMap } from './wot';
import { kvGet, kvSet, kvDelete } from './kv';
import type { Signer } from './signer';
import {
  DEFAULT_RELAYS,
  KIND_INTENT_OFFER,
  KIND_INTENT_REQUEST,
  buildIntentTemplate,
  parseIntentEvent,
  parseNegotiationMessage,
  applyInbound,
  applyOutbound,
  dedupeNegotiationMessages,
  makeAccept,
  makeCancel,
  makeCancelRequest,
  makeCancelAgree,
  makeCancelDecline,
  makeChat,
  makeCounter,
  makeStatus,
  openNegotiation,
  MSG_ACCEPT,
  type BuildIntentInput,
  type Intent,
  type Negotiation,
  type NegotiationMessage,
  type ProposedTerms,
} from '@freeport/protocol';

/** PoW difficulty (leading zero bits) mined into each posted intent. */
const POW_DIFFICULTY = 12;
/**
 * Minimum PoW to accept an inbound intent. 0 = off (ranking-only) so the
 * agent/CLI and older clients that don't mine still interoperate. Raise this
 * once all posters mine PoW to hard-drop spam below the floor.
 */
const MIN_INTENT_POW = 0;
/** Max distinct listings (d-tags) shown per author — caps single-key flooding. */
const MAX_LISTINGS_PER_AUTHOR = 5;
/** How far in the future a withdrawal's NIP-40 expiration is set. Must be > 0 so
 *  relays accept the event (a born-expired event is dropped and never relayed);
 *  kept short so the withdrawn tombstone purges network-wide soon after. */
const WITHDRAW_TTL_SECONDS = 600;
/** Local-storage key for persisted negotiations (survive app reload). */
const NEGO_STORE_KEY = 'freeport.negotiations';
/** Persisted own posts, so a deal can be rebuilt from an inbound accept even
 *  after the post's NIP-40 expiry makes relays stop serving it. */
const PUBLISHED_STORE_KEY = 'freeport.published';

export class MobileClient {
  // enableReconnect: SimplePool transparently re-opens a dropped relay socket
  // and replays active subscriptions (so an offer sent while we were offline is
  // re-delivered on reconnect). enablePing: detect a silently-dead socket (e.g.
  // after the OS froze us in the background) so reconnect actually triggers.
  readonly pool = new SimplePool({ enableReconnect: true, enablePing: true });
  readonly pubkey: string;
  /** Per-author set of accepted d-tags, to enforce the listing cap. */
  private authorListings = new Map<string, Set<string>>();
  readonly negotiations = new Map<string, Negotiation>();
  private published = new Map<string, Intent>();
  /** Cache of fetched kind:0 profiles keyed by pubkey. */
  readonly profiles = new Map<string, { name?: string; picture?: string; about?: string; phone?: string; vehicleModel?: string; plate?: string }>();
  /** Cache of fetched reputations keyed by pubkey. */
  readonly reputations = new Map<string, Reputation>();
  /** Recently seen market intents (others'), for client-side price suggestions. */
  readonly marketIntents = new Map<string, Intent>();
  /** Per-viewer web-of-trust weights, built once at startup. */
  private trustPromise: Promise<Map<string, number>> | null = null;
  /** Nego IDs whose receipt we already published. */
  private receiptsPublished = new Set<string>();
  /** Intent ids we've already withdrawn after a deal confirmed (publish once). */
  private withdrawnIntents = new Set<string>();
  /**
   * DMs that arrived before their intent was loaded (e.g. the accept backfill
   * races ahead of the own-post echo on reopen, or the post just expired).
   * Keyed by intent_id; replayed by flushPending() once the intent appears, so
   * a deal is never silently lost. Bounded per intent to avoid unbounded growth.
   */
  private pendingMsgs = new Map<string, Array<{ msg: NegotiationMessage; from: string; ts: number; eventId?: string }>>();
  onIntent?: (intent: Intent) => void;
  /** Fires for our own intents — both freshly posted and echoed back from relays on startup. */
  onOwnIntent?: (intent: Intent) => void;
  onNegotiationUpdate?: (nego: Negotiation) => void;
  /** Fires for a genuinely NEW inbound DM (not the startup backfill) — drives local notifications. */
  onIncomingMessage?: (nego: Negotiation, msg: NegotiationMessage) => void;
  onProfileFetched?: (pubkey: string) => void;
  onReputationFetched?: (pubkey: string) => void;
  /** Unix seconds when watchDMs started — used to skip notifying for backfilled history. */
  private watchStartTs = 0;

  constructor(
    private signer: Signer,
    readonly relays: string[] = DEFAULT_RELAYS,
  ) {
    this.pubkey = signer.pubkey;
  }

  /** How many of our relays currently have an open WebSocket. */
  connectedRelayCount(): number {
    let n = 0;
    try {
      for (const ok of this.pool.listConnectionStatus().values()) if (ok) n++;
    } catch {}
    return n;
  }

  /**
   * Eagerly re-open any dropped relay sockets. Call when the app returns to the
   * foreground: the OS may have frozen us and silently killed the sockets, and
   * we don't want to wait for the next ping/publish to notice. Re-subscribing
   * (done by the caller) then replays the live filters and backfills anything
   * that arrived while we were away.
   */
  async reconnect(): Promise<void> {
    await Promise.allSettled(
      this.relays.map((url) => this.pool.ensureRelay(url).catch(() => {})),
    );
  }

  /**
   * Store + persist a negotiation. Negotiations are otherwise in-memory only,
   * so a web reload (or app restart) would lose them — and a responder can't
   * rebuild one from an inbound DM (the intent isn't in their `published`).
   * Persisting to local storage keeps deals visible across reloads for BOTH
   * sides.
   */
  private commitNego(nego: Negotiation): void {
    this.negotiations.set(nego.id, nego);
    void this.persistNegotiations();
  }

  private async persistNegotiations(): Promise<void> {
    try {
      await kvSet(NEGO_STORE_KEY, JSON.stringify([...this.negotiations.values()]));
    } catch {
      /* best-effort; a failed write just means this change isn't cached */
    }
  }

  /** Persist own posts (pruned to the last 7 days) so a deal survives the post's
   *  relay-side NIP-40 expiry — the passenger can still rebuild the deal from an
   *  inbound accept even after relays stop serving the expired intent. */
  private async persistPublished(): Promise<void> {
    try {
      const cutoff = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
      const recent = [...this.published.values()].filter((i) => i.createdAt >= cutoff);
      await kvSet(PUBLISHED_STORE_KEY, JSON.stringify(recent));
    } catch {
      /* best-effort */
    }
  }

  private async loadPublished(): Promise<void> {
    try {
      const raw = await kvGet(PUBLISHED_STORE_KEY);
      if (!raw) return;
      for (const intent of JSON.parse(raw) as Intent[]) {
        if (intent?.id && !this.published.has(intent.id)) {
          this.published.set(intent.id, intent);
          this.flushPending(intent.id); // a waiting accept can now build its deal
        }
      }
    } catch {
      /* corrupt/absent → nothing to restore */
    }
  }

  /**
   * Rehydrate persisted negotiations into memory and replay them to the UI.
   * Call once after wiring callbacks, before watchDMs backfills live updates.
   */
  /** Erase persisted negotiations (call on sign-out so the next account starts clean). */
  static async clearStoredNegotiations(): Promise<void> {
    try { await kvDelete(NEGO_STORE_KEY); } catch { /* best-effort */ }
    try { await kvDelete(PUBLISHED_STORE_KEY); } catch { /* best-effort */ }
  }

  async loadNegotiations(): Promise<void> {
    await this.loadPublished(); // restore own posts first so inbound accepts can match
    try {
      const raw = await kvGet(NEGO_STORE_KEY);
      if (!raw) return;
      const list = JSON.parse(raw) as Negotiation[];
      let healed = false;
      for (const stored of list) {
        if (!stored?.id) continue;
        // Heal stores that accumulated duplicate chat messages before the
        // idempotent-chat fix; persist the cleaned copy so it doesn't recur.
        const nego = dedupeNegotiationMessages(stored);
        if (nego !== stored) healed = true;
        this.negotiations.set(nego.id, nego);
        this.onNegotiationUpdate?.(nego);
      }
      if (healed) void this.persistNegotiations();
    } catch {
      /* corrupt/absent store → start empty */
    }
  }

  private trust(): Promise<Map<string, number>> {
    if (!this.trustPromise) {
      this.trustPromise = buildTrustMap(this.pool, this.relays, this.pubkey).catch(() => new Map());
    }
    return this.trustPromise;
  }

  watchMarket(market: string | string[]): () => void {
    const markets = Array.isArray(market) ? market : [market];
    const sub = this.pool.subscribeMany(
      this.relays,
      {
        kinds: [KIND_INTENT_OFFER, KIND_INTENT_REQUEST],
        '#t': markets,
        since: Math.floor(Date.now() / 1000) - 24 * 3600,
      },
      {
        onevent: (ev: Event) => {
          const intent = parseIntentEvent(ev);
          if (!intent) return;
          if (intent.pubkey === this.pubkey) {
            // Our own post echoed back — also restores "My posts" after an app restart
            this.published.set(intent.id, intent);
            void this.persistPublished();
            this.flushPending(intent.id); // a deal's accept DM may have been waiting on this
            this.onOwnIntent?.(intent);
            return;
          }
          // Self-policing: hide prohibited (illegal) listings from the feed.
          if (!screenIntentContent(intent.content.schema, intent.content.title, intent.content.payload as any).allowed) return;
          // Spam floor: drop intents below the PoW threshold (off by default).
          if (MIN_INTENT_POW > 0 && getPow(ev.id) < MIN_INTENT_POW) return;
          // Anti-flood: cap distinct listings per author. Updates to an
          // already-accepted listing (same d-tag) always pass through.
          let seen = this.authorListings.get(intent.pubkey);
          if (!seen) { seen = new Set(); this.authorListings.set(intent.pubkey, seen); }
          if (!seen.has(intent.d)) {
            if (seen.size >= MAX_LISTINGS_PER_AUTHOR) return;
            seen.add(intent.d);
          }
          this.marketIntents.set(intent.id, intent);
          this.flushPending(intent.id); // a deal's DM may have been waiting on this intent
          this.onIntent?.(intent);
          this.fetchProfile(intent.pubkey);
          this.fetchReputation(intent.pubkey);
        },
      },
    );
    return () => sub.close();
  }

  /** Fetch and cache a counterparty's kind:0 profile. No-op if already cached. */
  private fetchProfile(pubkey: string): void {
    if (this.profiles.has(pubkey)) return;
    this.profiles.set(pubkey, {}); // mark as in-flight
    const sub = this.pool.subscribeMany(
      this.relays,
      { kinds: [0], authors: [pubkey], limit: 1 },
      {
        onevent: (ev: Event) => {
          try {
            const meta = JSON.parse(ev.content);
            this.profiles.set(pubkey, { name: meta.name, picture: meta.picture, about: meta.about, phone: meta.phone, vehicleModel: meta.vehicle_model, plate: meta.plate });
            this.onProfileFetched?.(pubkey);
          } catch {}
        },
        oneose: () => sub.close(),
      },
    );
  }

  private reputationInFlight = new Set<string>();

  fetchReputation(pubkey: string): void {
    if (this.reputations.has(pubkey) || this.reputationInFlight.has(pubkey)) return;
    this.reputationInFlight.add(pubkey);
    this.trust()
      .then((trust) => fetchReputation(this.pool, this.relays, pubkey, trust))
      .then((rep) => {
        this.reputations.set(pubkey, rep);
        this.onReputationFetched?.(pubkey);
      })
      .catch(() => {})
      .finally(() => this.reputationInFlight.delete(pubkey));
  }

  async rateKarma(
    negoId: string,
    ratee: string,
    score: KarmaScore,
    note?: string,
    contactVerified = false,
  ): Promise<void> {
    // Attest the masked form of the number we ACTUALLY received via encrypted
    // DM at deal time — readers cross-check it against the peer's public mask.
    let contactMasked: string | undefined;
    if (contactVerified) {
      const theirContact = this.negotiations.get(negoId)?.theirContact ?? '';
      const m = theirContact.match(/\+?\d[\d\s.-]{6,}\d/);
      if (m) contactMasked = maskPhone(m[0].replace(/[\s.-]/g, ''));
    }
    await publishKarma(this.pool, this.signer, ratee, score, negoId, note, contactVerified, contactMasked, this.relays);
  }

  /**
   * Our intent can only be fulfilled once. When a deal on it confirms, cancel
   * every OTHER still-open negotiation on the same intent so the losing bidders
   * can't also accept and double-book us. Only the intent's author sweeps.
   */
  private maybeCancelLosingBids(nego: Negotiation): void {
    if (nego.state !== 'confirmed') return;
    if (nego.intent.pubkey !== this.pubkey) return; // only the owner of the intent sweeps
    for (const other of this.negotiations.values()) {
      if (other.id === nego.id || other.intent.id !== nego.intent.id) continue;
      if (other.state === 'confirmed' || other.state === 'cancelled' || other.state === 'expired') continue;
      const msg = makeCancel(other, 'Filled — taken by another offer');
      const updated = applyOutbound(other, msg);
      this.commitNego(updated);
      this.sendDM(updated.peer, JSON.stringify(msg)).catch(() => {});
      this.onNegotiationUpdate?.(updated);
    }
  }

  /** Publish our half of the deal receipt once a negotiation confirms. */
  private maybePublishReceipt(nego: Negotiation): void {
    this.maybeWithdrawOwnIntent(nego);
    this.maybeCancelLosingBids(nego);
    if (nego.state !== 'confirmed' || this.receiptsPublished.has(nego.id)) return;
    this.receiptsPublished.add(nego.id);
    publishReceipt(this.pool, this.signer, nego.id, nego.peer, nego.intent.id, this.relays).catch(() => {
      this.receiptsPublished.delete(nego.id); // retry on next state update
    });
  }

  /**
   * When our OWN posted intent closes a deal, withdraw it from the network so it
   * stops showing in other users' Browse: republish the same d-tag addressable
   * event with an already-passed expiration and empty payload. Relays replace
   * the prior version (and NIP-40-aware relays drop it), and updated clients'
   * expiry filter removes it from the feed. Only the author can do this.
   */
  private maybeWithdrawOwnIntent(nego: Negotiation): void {
    if (nego.state !== 'confirmed') return;
    const intent = nego.intent;
    if (intent.pubkey !== this.pubkey) return;            // only the intent's author can withdraw it
    if (this.withdrawnIntents.has(intent.id)) return;
    this.withdrawnIntents.add(intent.id);
    const now = Math.floor(Date.now() / 1000);
    const tmpl = buildIntentTemplate({
      side: intent.content.side,
      market: intent.content.market,
      schema: intent.content.schema,
      title: '(withdrawn)',
      payload: { withdrawn: true },
      expiresAt: now,
      d: intent.d,
      createdAt: now,
    });
    this.signer
      .signEvent({ kind: tmpl.kind, created_at: tmpl.created_at, tags: tmpl.tags, content: tmpl.content })
      .then((ev) => {
        const withdrawn = parseIntentEvent(ev);
        if (withdrawn) { this.published.set(withdrawn.id, withdrawn); this.onOwnIntent?.(withdrawn); }
        return Promise.any(this.pool.publish(this.relays, ev));
      })
      .catch(() => { this.withdrawnIntents.delete(intent.id); }); // retry on next state update
  }

  /**
   * Manually withdraw one of our own still-open intents — e.g. a passenger
   * cancels an unconfirmed ride request. Same mechanism as the post-deal
   * withdraw: republish the addressable d-tag (same d, newer created_at) with a
   * `withdrawn` payload so relays replace the live version and clients' Browse
   * filter drops it. The expiration is set a few minutes in the FUTURE, not to
   * `now`: a born-expired event (expiration ≤ now) is rejected/instantly dropped
   * by NIP-40-honoring relays, so the withdrawal would never propagate and the
   * counterparty would keep seeing the original. The short TTL still purges it
   * network-wide soon after; our clients hide it immediately via `withdrawn`.
   * Only the author can withdraw their own intent.
   */
  async withdrawIntent(intent: Intent): Promise<void> {
    if (intent.pubkey !== this.pubkey) return;
    this.withdrawnIntents.add(intent.id);
    const now = Math.floor(Date.now() / 1000);
    const tmpl = buildIntentTemplate({
      side: intent.content.side,
      market: intent.content.market,
      schema: intent.content.schema,
      title: '(withdrawn)',
      payload: { withdrawn: true },
      expiresAt: now + WITHDRAW_TTL_SECONDS,
      d: intent.d,
      createdAt: now,
    });
    try {
      const ev = await this.signer.signEvent({ kind: tmpl.kind, created_at: tmpl.created_at, tags: tmpl.tags, content: tmpl.content });
      const withdrawn = parseIntentEvent(ev);
      if (withdrawn) { this.published.set(withdrawn.id, withdrawn); this.onOwnIntent?.(withdrawn); }
      await Promise.any(this.pool.publish(this.relays, ev));
    } catch (e) {
      this.withdrawnIntents.delete(intent.id); // allow retry
      throw e;
    }
    // Withdrawing the listing must also close any in-flight negotiation on it —
    // otherwise a counter-offer the peer already sent lingers on our Active tab
    // with Accept/Counter/Decline for a request we just cancelled. Cancel each
    // non-terminal negotiation (notifies the peer via DM, same as the
    // double-book sweep) so both sides drop the deal.
    this.cancelNegotiationsForIntent(intent.id, 'Request cancelled');
  }

  /** Cancel every still-open negotiation on the given intent id and notify the
   *  peers. Used when the author withdraws/cancels the underlying listing. */
  private cancelNegotiationsForIntent(intentId: string, reason: string): void {
    for (const nego of this.negotiations.values()) {
      if (nego.intent.id !== intentId) continue;
      // Only sweep still-pending bids. A confirmed deal is a commitment with its
      // own mutual-cancel flow, so withdrawing the listing must not silently kill
      // it; terminal states need no action.
      if (nego.state !== 'open' && nego.state !== 'accepted_by_us' && nego.state !== 'accepted_by_them') continue;
      const msg = makeCancel(nego, reason);
      const updated = applyOutbound(nego, msg);
      this.commitNego(updated);
      this.sendDM(updated.peer, JSON.stringify(msg)).catch(() => { /* best-effort */ });
      this.onNegotiationUpdate?.(updated);
    }
  }

  watchDMs(): () => void {
    this.watchStartTs = Math.floor(Date.now() / 1000);
    const sub = this.pool.subscribeMany(
      this.relays,
      { kinds: [4], '#p': [this.pubkey], since: Math.floor(Date.now() / 1000) - 7 * 24 * 3600 },
      {
        onevent: async (ev: Event) => {
          try {
            const plain = await this.signer.nip04Decrypt(ev.pubkey, ev.content);
            const msg = parseNegotiationMessage(plain);
            if (!msg) return;
            this.processDM(msg, ev.pubkey, ev.created_at, false, ev.id);
          } catch {
            /* not a Freeport DM */
          }
        },
      },
    );
    return () => sub.close();
  }

  /**
   * Apply one decrypted negotiation DM. If its intent isn't loaded yet, queue it
   * (see pendingMsgs) and replay later via flushPending — so a deal isn't lost
   * when the accept backfill races ahead of the own-post echo, or the post just
   * expired. `replay` marks a queued message so it isn't re-queued forever.
   */
  private processDM(msg: NegotiationMessage, from: string, createdAt: number, replay = false, eventId?: string): void {
    let nego = this.negotiations.get(msg.nego);
    if (!nego) {
      // The intent may be ours (`published`) OR a market intent we responded to
      // as the initiator (`marketIntents`).
      const intent = this.published.get(msg.intent_id) ?? this.marketIntents.get(msg.intent_id);
      if (!intent) {
        if (!replay) {
          const q = this.pendingMsgs.get(msg.intent_id) ?? [];
          if (q.length < 50 && !q.some((p) => p.msg.nego === msg.nego && p.msg.type === msg.type && p.ts === createdAt)) {
            q.push({ msg, from, ts: createdAt, eventId });
            this.pendingMsgs.set(msg.intent_id, q);
          }
        }
        return;
      }
      // Initiator iff it isn't our own intent.
      nego = openNegotiation(intent, this.pubkey, intent.pubkey !== this.pubkey, from);
      if (nego.id !== msg.nego) return;
    }
    // Our intent is already filled? Reject a late/racing accept from a losing
    // bidder instead of opening a second deal — cancel them.
    if (
      msg.type === MSG_ACCEPT &&
      nego.intent.pubkey === this.pubkey &&
      nego.state !== 'confirmed' &&
      [...this.negotiations.values()].some(
        (n) => n.id !== nego!.id && n.intent.id === nego!.intent.id && n.state === 'confirmed',
      )
    ) {
      const cancelMsg = makeCancel(nego, 'Filled — taken by another offer');
      const cancelled = applyOutbound(nego, cancelMsg);
      this.commitNego(cancelled);
      this.sendDM(cancelled.peer, JSON.stringify(cancelMsg)).catch(() => {});
      this.onNegotiationUpdate?.(cancelled);
      return;
    }
    const updated = applyInbound(nego, msg, from, eventId);
    if (!updated) return;
    this.commitNego(updated);
    this.maybePublishReceipt(updated);
    this.onNegotiationUpdate?.(updated);
    // Only notify for live messages — skip the 7-day backfill replayed on startup.
    if (createdAt >= this.watchStartTs - 5) this.onIncomingMessage?.(updated, msg);
  }

  /** Replay any DMs that were waiting on this intent (now that it's loaded). */
  private flushPending(intentId: string): void {
    const q = this.pendingMsgs.get(intentId);
    if (!q) return;
    this.pendingMsgs.delete(intentId);
    // Oldest-first so offers/counters apply before the accept that confirms them.
    for (const p of q.sort((a, b) => a.ts - b.ts)) this.processDM(p.msg, p.from, p.ts, true, p.eventId);
  }

  /**
   * Publish the user's kind:0 profile (NIP-01). Call whenever the profile is
   * saved so counterparties can fetch the author's name/picture/about.
   */
  async publishProfile(profile: UserProfile): Promise<void> {
    await publishProfile(this.signer, profile, this.relays);
  }

  /**
   * Post an intent. If a profile is provided it is (re-)published first so
   * counterparties see up-to-date metadata alongside the new intent.
   */
  async postIntent(input: BuildIntentInput, profile?: UserProfile): Promise<Intent> {
    // Refuse to publish prohibited (illegal) content under the user's key.
    const verdict = screenIntent(
      (input.payload as any)?.category,
      input.title,
      (input.payload as any)?.service,
      (input.payload as any)?.notes,
      (input.payload as any)?.note,
      (input.payload as any)?.from?.name,
      (input.payload as any)?.to?.name,
      (input.payload as any)?.location?.name,
      (input.payload as any)?.subcategory,
    );
    if (!verdict.allowed) throw new Error(verdict.reason ?? 'This listing is not allowed.');
    if (profile && (profile.name || profile.picture || profile.about || profile.phone)) {
      // Fire-and-forget: profile publish is best-effort, don't block posting
      publishProfile(this.signer, profile, this.relays).catch(() => {});
    }
    // Mine NIP-13 PoW so each post carries a CPU cost (anti-spam). The nonce
    // tag is preserved through signing, so the published id keeps its PoW.
    const tmpl = buildIntentTemplate(input);
    let mined: any = { ...tmpl, pubkey: this.signer.pubkey };
    try { mined = await minePowAsync(mined, POW_DIFFICULTY); } catch { /* best-effort */ }
    const ev = await this.signer.signEvent({
      kind: mined.kind, created_at: mined.created_at, tags: mined.tags, content: mined.content,
    });
    const intent = parseIntentEvent(ev)!;
    this.published.set(intent.id, intent);
    void this.persistPublished();
    await Promise.any(this.pool.publish(this.relays, ev));
    this.onOwnIntent?.(intent); // immediate UI feedback, no relay round-trip
    return intent;
  }

  /**
   * Initiate a negotiation against a market intent (e.g. a driver claiming a
   * ride request). Opens the negotiation as initiator and sends the first
   * proposal as a counter. Returns the new negotiation id, or null if it
   * already exists (don't double-open).
   */
  async respond(intent: Intent, terms: ProposedTerms, contact?: string): Promise<string | null> {
    const nego = openNegotiation(intent, this.pubkey, true, intent.pubkey);
    if (this.negotiations.has(nego.id)) return null;
    const msg = makeCounter(nego, terms, contact);
    const updated = applyOutbound(nego, msg);
    this.commitNego(updated);
    await this.sendDM(updated.peer, JSON.stringify(msg));
    this.onNegotiationUpdate?.(updated);
    return updated.id;
  }

  /**
   * Take a market intent at its EXACT posted terms — a one-tap accept that
   * confirms the deal immediately, with no counter round and no second
   * "Confirm" from the intent's owner. We open the negotiation as initiator,
   * seat the intent's own terms (so there's something to accept), and send an
   * Accept carrying our contact. The owner's client confirms on receipt and
   * auto-replies with their contact (the existing back-flow), so both sides end
   * up confirmed with each other's details. Returns the negotiation id, or null
   * if one already exists (don't double-open).
   */
  async acceptIntent(intent: Intent, terms: ProposedTerms, contact: string): Promise<string | null> {
    const base = openNegotiation(intent, this.pubkey, true, intent.pubkey);
    if (this.negotiations.has(base.id)) return null;
    // Terms originate from the intent owner ("them"); seating them lets
    // makeAccept (which accepts `nego.terms`) build a valid confirming message.
    const seeded: Negotiation = { ...base, terms, termsBy: 'them' };
    const msg = makeAccept(seeded, contact);
    const updated = applyOutbound(seeded, msg);
    this.commitNego(updated);
    await this.sendDM(updated.peer, JSON.stringify(msg));
    this.maybePublishReceipt(updated);
    this.onNegotiationUpdate?.(updated);
    return updated.id;
  }

  /** True if we already have a negotiation open for this intent. */
  hasNegotiationFor(intent: Intent): boolean {
    const id = openNegotiation(intent, this.pubkey, true, intent.pubkey).id;
    return this.negotiations.has(id);
  }

  /** Human tapped "Accept" on a pending negotiation. */
  async accept(negoId: string, contact: string): Promise<void> {
    const nego = this.negotiations.get(negoId);
    if (!nego) return;
    const msg = makeAccept(nego, contact);
    const updated = applyOutbound(nego, msg);
    this.commitNego(updated);
    await this.sendDM(updated.peer, JSON.stringify(msg));
    this.maybePublishReceipt(updated);
    this.onNegotiationUpdate?.(updated);
  }

  /** Human edited and submitted a counter-offer. */
  async counter(negoId: string, terms: ProposedTerms, contact?: string): Promise<void> {
    const nego = this.negotiations.get(negoId);
    if (!nego) return;
    const msg = makeCounter(nego, terms, contact);
    const updated = applyOutbound(nego, msg);
    this.commitNego(updated);
    await this.sendDM(updated.peer, JSON.stringify(msg));
    this.onNegotiationUpdate?.(updated);
  }

  /** Send a free-text chat message in a negotiation (used after confirmation). */
  async sendChat(negoId: string, text: string): Promise<void> {
    const nego = this.negotiations.get(negoId);
    if (!nego || !text.trim()) return;
    const msg = makeChat(nego, text.trim());
    const updated = applyOutbound(nego, msg);
    this.commitNego(updated);
    await this.sendDM(updated.peer, JSON.stringify(msg));
    this.onNegotiationUpdate?.(updated);
  }

  /**
   * Advance fulfillment on a confirmed deal (e.g. driver tapped "Picked up" /
   * "Completed trip"). Persists locally and DMs the stage to the counterparty
   * so both deal cards stay in sync.
   */
  async setStage(negoId: string, stage: 'picked_up' | 'completed'): Promise<void> {
    const nego = this.negotiations.get(negoId);
    if (!nego) return;
    const msg = makeStatus(nego, stage);
    const updated = applyOutbound(nego, msg);
    this.commitNego(updated);
    await this.sendDM(updated.peer, JSON.stringify(msg));
    this.onNegotiationUpdate?.(updated);
  }

  /** Human tapped "Decline". */
  async decline(negoId: string): Promise<void> {
    const nego = this.negotiations.get(negoId);
    if (!nego) return;
    const msg = makeCancel(nego, 'declined');
    const updated = applyOutbound(nego, msg);
    this.commitNego(updated);
    await this.sendDM(updated.peer, JSON.stringify(msg));
    this.onNegotiationUpdate?.(updated);
  }

  /** Mutual cancellation of a confirmed deal. */
  private async sendCancelStep(negoId: string, make: (n: Negotiation) => any): Promise<void> {
    const nego = this.negotiations.get(negoId);
    if (!nego) return;
    const msg = make(nego);
    const updated = applyOutbound(nego, msg);
    this.commitNego(updated);
    await this.sendDM(updated.peer, JSON.stringify(msg));
    this.onNegotiationUpdate?.(updated);
  }
  /** Ask the counterparty to mutually cancel a confirmed deal. */
  requestCancel(negoId: string) { return this.sendCancelStep(negoId, makeCancelRequest); }
  /** Agree to the other party's cancellation request → cancelled (karma stays 0). */
  agreeCancel(negoId: string) { return this.sendCancelStep(negoId, makeCancelAgree); }
  /** Decline the cancellation request → deal reverts to confirmed. */
  keepDeal(negoId: string) { return this.sendCancelStep(negoId, makeCancelDecline); }

  private async sendDM(to: string, plaintext: string): Promise<void> {
    const ciphertext = await this.signer.nip04Encrypt(to, plaintext);
    const ev = await this.signer.signEvent({
      kind: 4,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', to]],
      content: ciphertext,
    });
    await Promise.any(this.pool.publish(this.relays, ev));
  }
}
