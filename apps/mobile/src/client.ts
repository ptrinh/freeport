/**
 * Thin Nostr client for the app: subscribe to a market, post intents,
 * track negotiations. Mirrors packages/agent/src/transport.ts but with
 * React-state-friendly callbacks (React Native has WebSocket built in).
 */
import { SimplePool } from 'nostr-tools/pool';
import { type Event, verifyEvent } from 'nostr-tools/pure';
import { createRumor, createSeal, createWrap } from 'nostr-tools/nip59';
import { getConversationKey as nip44ConvKey, decrypt as nip44Decrypt } from 'nostr-tools/nip44';
import { getPow } from 'nostr-tools/nip13';
import { minePowAsync } from './pow';
import { screenIntent, screenIntentContent } from './moderation';
import { publishProfile, maskPhone, httpsLinkOrNull, type UserProfile } from './profile';
import { publishKarma, type KarmaScore } from './karma';
import { publishReceipt } from './receipts';
import { fetchReputation, type Reputation } from './reputation';
import { buildTrustMap } from './wot';
import { kvGet, kvSet, kvDelete } from './kv';
import { query } from './query';
import { kvCacheGet, kvCacheSet, kvCacheDelete } from './kvCache';
import type { Signer } from './signer';
import { sha256 } from '@noble/hashes/sha2.js';
import { applyChatInbound, applyChatOutbound, newConversation, sweepExpired, type Conversation } from './conversations';
import {
  DEFAULT_RELAYS,
  SCHEMA_VERSION,
  KIND_INTENT_OFFER,
  KIND_INTENT_REQUEST,
  KIND_CHAT_INVITE,
  KIND_KARMA,
  KIND_GROUP_INVITE,
  KIND_GROUP_JOIN,
  makeGroupJoinContent,
  parseGroupJoin,
  type GroupInvite,
  type GroupDescriptor,
  CHAT_INVITE,
  CHAT_ACCEPT,
  CHAT_REJECT,
  CHAT_MSG,
  buildIntentTemplate,
  parseIntentEvent,
  parseNegotiationMessage,
  parseChatEnvelope,
  makeChatInvite,
  makeChatAccept,
  makeChatReject,
  makeChatMsg,
  makeChatAck,
  makeChatReact,
  makeChatTtl,
  mintInviteCode,
  verifyInviteCode,
  KIND_PRODUCT,
  buildProductTemplate,
  buildProductRemovalTemplate,
  parseProductEvent,
  type BuildProductInput,
  type Product,
  parseCallEnvelope,
  callOfferFresh,
  CALL_OFFER,
  parseEscrowEnvelope,
  makeEscrowRequest,
  makeEscrowInvoice,
  makeEscrowRelease,
  ESCROW_REQUEST,
  ESCROW_INVOICE,
  ESCROW_RELEASE,
  type EscrowEnvelope,
  type CallEnvelope,
  type ChatEnvelope,
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
  MSG_COUNTER,
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
/** Session-cache bounds (see pruneSessionCaches). */
const MAX_MARKET_INTENTS = 10000;
const MAX_PEER_CACHE = 2000;
const PRUNE_EVERY_INTENTS = 200;
/** How far in the future a withdrawal's NIP-40 expiration is set. Must be > 0 so
 *  relays accept the event (a born-expired event is dropped and never relayed);
 *  kept short so the withdrawn tombstone purges network-wide soon after. */
const WITHDRAW_TTL_SECONDS = 600;
/** Local-storage key for persisted negotiations (survive app reload). */
const NEGO_STORE_KEY = 'freeport.negotiations';
/** Persisted own posts, so a deal can be rebuilt from an inbound accept even
 *  after the post's NIP-40 expiry makes relays stop serving it. */
const PUBLISHED_STORE_KEY = 'freeport.published';
/** Signed-but-undelivered DMs (all relays down / offline), retried on reconnect. */
const OUTBOX_STORE_KEY = 'freeport.outbox';
/** created_at of the newest DM ever processed — bounds the startup backfill. */
const DM_LAST_SEEN_KEY = 'freeport.dmLastSeen';
/** Re-fetch this far behind lastSeen: relays deliver out of order, and an
 *  offline counterparty's DM can be published long after it was written. */
const DM_BACKFILL_MARGIN_SECONDS = 24 * 3600;
/** Absolute backfill floor (first launch / stale lastSeen). */
const DM_BACKFILL_MAX_SECONDS = 7 * 24 * 3600;
/** Outbox entries older than this are dropped on load — the deal has moved on. */
const OUTBOX_MAX_AGE_SECONDS = 7 * 24 * 3600;
/** Persisted friend-chat conversations (experimental Chat feature). */
const CHAT_STORE_KEY = 'freeport.conversations';
/** The user's current invite {code, nonce} — one active invite at a time. */
const CHAT_INVITE_KEY = 'freeport.chatInvite';
/** Relay-side lifetime of a published invite (NIP-40). Regenerating is cheap. */
const CHAT_INVITE_TTL_SECONDS = 7 * 24 * 3600;
/** Coalesce delivered-acks per peer so a message burst sends ONE receipt. */
const CHAT_ACK_DELAY_MS = 300;
/** Persisted escrows — the buyer's PREIMAGE lives here; losing it means the
 *  buyer can only wait for the expiry refund, so persist aggressively. */
const ESCROW_STORE_KEY = 'freeport.escrows';
/** Hold-invoice lifetime: unreleased funds auto-refund to the buyer after this. */
const ESCROW_EXPIRY_SECONDS = 24 * 3600;
/** Market-feed snapshot cache (per market key). Hydrated on watchMarket so the
 *  feed paints instantly instead of being rebuilt from the relay backfill
 *  (which floods a re-render/profile-fetch burst). Bounded + windowed. */
const FEED_STORE_PREFIX = 'freeport.feed.';
const FEED_MAX = 300;
const FEED_MAX_AGE_SECONDS = 24 * 3600;

/** One escrow per deal. The buyer's `preimage` is the money key — persisted. */
export interface EscrowState {
  nego: string;
  peer: string;
  role: 'buyer' | 'seller';
  hash: string;
  amountSats: number;
  /** Buyer: minted locally. Seller: arrives with the release. */
  preimage?: string;
  invoice?: string;
  status: 'requested' | 'invoiced' | 'released' | 'settled' | 'claim_failed';
  updatedAt: number;
  seenEventIds?: string[];
}

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
  readonly profiles = new Map<string, { name?: string; picture?: string; about?: string; phone?: string; vehicleModel?: string; plate?: string; lud16?: string; link?: string }>();
  /** Cache of fetched reputations keyed by pubkey. */
  readonly reputations = new Map<string, Reputation>();
  /** Cache of a peer's VERIFIED group-join attestations, keyed by pubkey.
   *  Powers the "Same group" badge (matched against myGroupGids). */
  readonly peerGroups = new Map<string, GroupInvite[]>();
  /** Group ids the LOCAL user has joined — set by App from the prefs store.
   *  Kept here so card/profile rendering can match without prop-drilling. */
  myGroupGids = new Set<string>();
  /** Recently seen market intents (others'), for client-side price suggestions. */
  readonly marketIntents = new Map<string, Intent>();
  /** Storefront products keyed by `${pubkey}|${d}` (latest addressable wins). */
  readonly products = new Map<string, Product>();
  onProduct?: (product: Product) => void;
  /** A product of OURS was removed (tombstone echoed back / local remove). */
  onProductRemoved?: (pubkey: string, d: string) => void;
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
  /** Peer pubkeys (hex) the user has blocked — inbound DMs from them are dropped. */
  private blocked = new Set<string>();
  /**
   * Inbound NIP-59 gift wraps awaiting unwrap. Each unwrap is ~3 secp256k1 ops
   * + 2 NIP-44 decrypts on the JS thread (see unwrapVerified) — a synchronous
   * onevent handler processing the whole connect-time backfill back-to-back
   * froze the UI for seconds until "Connected". We instead queue and drain a
   * few per macrotask, yielding the thread between batches so the app stays
   * responsive. Verification logic is unchanged; only the schedule is.
   */
  private wrapQueue: Event[] = [];
  private wrapDraining = false;
  /**
   * How the FIRST wrap-drain of a burst is scheduled. Defaults to a macrotask;
   * the app overrides it (setWrapKick) to run after the initial UI interactions
   * settle so first paint / taps during the connect burst aren't competing with
   * the unwrap CPU. Later batches always re-schedule on a plain macrotask.
   */
  private wrapKick: (fn: () => void) => void = (fn) => { setTimeout(fn, 0); };
  /**
   * Signed DMs that could not reach ANY relay (offline, all relays down).
   * Local negotiation state commits optimistically, so these MUST eventually
   * deliver or the two parties diverge — a deal card reading "Confirmed" while
   * the counterparty never heard the accept. Persisted; flushed on reconnect.
   */
  private outbox: Array<{ event: Event }> = [];
  private flushingOutbox = false;
  /** Newest kind-4 created_at seen for us — bounds the next startup backfill. */
  private dmLastSeenTs = 0;
  onIntent?: (intent: Intent) => void;
  /** Fires for our own intents — both freshly posted and echoed back from relays on startup. */
  onOwnIntent?: (intent: Intent) => void;
  onNegotiationUpdate?: (nego: Negotiation) => void;
  /**
   * Resolves our wallet receive address to attach to accept messages (set by
   * the app when the Wallet experiment is on). Kept as a callback so the
   * wallet only boots when a deal is actually being sealed — never at startup.
   */
  getPayAddress?: () => Promise<string | null>;
  /** Fires for a genuinely NEW inbound DM (not the startup backfill) — drives local notifications. */
  onIncomingMessage?: (nego: Negotiation, msg: NegotiationMessage) => void;
  onProfileFetched?: (pubkey: string) => void;
  onReputationFetched?: (pubkey: string) => void;
  /** Fires whenever the undelivered-DM count changes — drives the "unsent" UI hint. */
  onOutboxChange?: (pending: number) => void;
  /** Unix seconds when watchDMs started — used to skip notifying for backfilled history. */
  private watchStartTs = 0;

  // ─── Friend chat (experimental) ────────────────────────────────────────────
  /** Conversations keyed by peer pubkey (hex). See src/conversations.ts. */
  readonly conversations = new Map<string, Conversation>();
  onConversationUpdate?: (conv: Conversation) => void;
  /** Fires for a genuinely NEW inbound chat envelope (invite or message). */
  onIncomingChat?: (conv: Conversation, env: ChatEnvelope) => void;
  /** Receipts/last-seen toggles (Settings → Chat); both reciprocal + off by default. */
  private chatPrefs = { receipts: false, lastSeen: false };
  private ackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private ackMax = new Map<string, number>();
  private chatPersistTimer: ReturnType<typeof setTimeout> | null = null;
  // ─── HODL escrow (deal-scoped conditional payments) ────────────────────────
  readonly escrows = new Map<string, EscrowState>();
  onEscrowUpdate?: (escrow: EscrowState) => void;
  /** Wallet hooks for escrow, set by the app when the Wallet experiment is on
   *  (Breez only — NWC has no HTLC surface). Lazily boots the wallet. */
  getEscrowWallet?: () => Promise<{
    createHoldInvoice(sats: number, description: string, paymentHashHex: string, expirySecs: number): Promise<string>;
    claimHtlc(preimageHex: string): Promise<void>;
  } | null>;
  private escrowPersistTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Live call signaling from a peer (see calls/manager.ts). Only fires for:
   * LIVE events (never the startup backfill — an old offer must not ring),
   * peers with an ACTIVE friend-chat conversation (handshake = spam gate),
   * and offers still within their freshness TTL. Answer/hangup replays are
   * additionally deduped per event id by the manager's call-id check.
   */
  onCallSignal?: (from: string, env: CallEnvelope) => void;

  constructor(
    private signer: Signer,
    readonly relays: string[] = DEFAULT_RELAYS,
  ) {
    this.pubkey = signer.pubkey;
  }

  /**
   * Sign a short-lived NIP-98-style auth event (kind 27235) proving this
   * client controls `this.pubkey` — used by the notify /subscribe endpoint so
   * only the key owner can enroll a DM-watch push for their pubkey.
   */
  signAuthEvent(template: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<Event> {
    return this.signer.signEvent(template);
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
    void this.flushOutbox();
  }

  /** Number of signed DMs still waiting for a relay to take them. */
  outboxPending(): number {
    return this.outbox.length;
  }

  /** Retry every queued DM. Failures re-queue; safe to call repeatedly. */
  async flushOutbox(): Promise<void> {
    if (this.flushingOutbox || !this.outbox.length) return;
    this.flushingOutbox = true;
    try {
      const items = this.outbox;
      this.outbox = [];
      for (const it of items) await this.publishDM(it.event);
    } finally {
      this.flushingOutbox = false;
      void this.persistOutbox();
      this.onOutboxChange?.(this.outbox.length);
    }
  }

  private async persistOutbox(): Promise<void> {
    try {
      await kvCacheSet(OUTBOX_STORE_KEY, JSON.stringify(this.outbox));
    } catch { /* best-effort */ }
  }

  private async loadOutbox(): Promise<void> {
    try {
      const raw = await kvCacheGet(OUTBOX_STORE_KEY);
      if (!raw) return;
      const cutoff = Math.floor(Date.now() / 1000) - OUTBOX_MAX_AGE_SECONDS;
      this.outbox = (JSON.parse(raw) as Array<{ event: Event }>).filter(
        (it) => it?.event?.id && it.event.created_at >= cutoff,
      );
      if (this.outbox.length) {
        this.onOutboxChange?.(this.outbox.length);
        void this.flushOutbox();
      }
    } catch { /* corrupt/absent → start empty */ }
  }

  /**
   * Publish a signed DM, queueing it for retry when no relay accepts it.
   * Returns true when at least one relay took the event now, false when queued.
   */
  private async publishDM(ev: Event): Promise<boolean> {
    try {
      await Promise.any(this.pool.publish(this.relays, ev));
      return true;
    } catch {
      this.outbox.push({ event: ev });
      void this.persistOutbox();
      this.onOutboxChange?.(this.outbox.length);
      return false;
    }
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

  /**
   * Persist is DEBOUNCED (trailing): it serializes the entire store, and the
   * startup DM backfill applies hundreds of messages in a burst — one write
   * per message meant hundreds of full-store JSON.stringify + KV writes at
   * every launch. One trailing write captures the same final state.
   */
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  private async persistNegotiations(): Promise<void> {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistNegotiationsNow();
    }, 250);
  }

  private async persistNegotiationsNow(): Promise<void> {
    try {
      await kvCacheSet(NEGO_STORE_KEY, JSON.stringify([...this.negotiations.values()]));
      if (this.dmLastSeenTs > 0) await kvCacheSet(DM_LAST_SEEN_KEY, String(this.dmLastSeenTs));
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
      await kvCacheSet(PUBLISHED_STORE_KEY, JSON.stringify(recent));
    } catch {
      /* best-effort */
    }
  }

  private async loadPublished(): Promise<void> {
    try {
      const raw = await kvCacheGet(PUBLISHED_STORE_KEY);
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
    try { await kvCacheDelete(NEGO_STORE_KEY); } catch { /* best-effort */ }
    try { await kvCacheDelete(PUBLISHED_STORE_KEY); } catch { /* best-effort */ }
    try { await kvCacheDelete(OUTBOX_STORE_KEY); } catch { /* best-effort */ }
    try { await kvCacheDelete(DM_LAST_SEEN_KEY); } catch { /* best-effort */ }
    try { await kvCacheDelete(CHAT_STORE_KEY); } catch { /* best-effort */ }
    try { await kvDelete(CHAT_INVITE_KEY); } catch { /* best-effort */ }
    try { await kvCacheDelete(ESCROW_STORE_KEY); } catch { /* best-effort */ }
  }

  async loadNegotiations(): Promise<void> {
    try {
      const ts = Number(await kvCacheGet(DM_LAST_SEEN_KEY));
      if (Number.isFinite(ts) && ts > 0) this.dmLastSeenTs = ts;
    } catch { /* first launch */ }
    await this.loadOutbox(); // undelivered DMs from the previous session retry first
    await this.loadPublished(); // restore own posts first so inbound accepts can match
    await this.loadConversations(); // friend chats (experimental Chat feature)
    await this.loadEscrows(); // HODL escrows — the buyer's preimage lives here
    try {
      const raw = await kvCacheGet(NEGO_STORE_KEY);
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

  /** Newest intent created_at this session has seen — a resume resubscribes
   *  from here (minus a skew margin) instead of re-downloading and re-parsing
   *  the full 24 h window (and re-triggering profile/reputation fetches for
   *  every author) on every foreground. */
  private marketNewestTs = 0;
  /** Current feed-cache key (set by watchMarket) + its debounced persist timer. */
  private feedKey = '';
  private feedPersistTimer: ReturnType<typeof setTimeout> | null = null;

  watchMarket(market: string | string[]): () => void {
    const markets = Array.isArray(market) ? market : [market];
    const now = Math.floor(Date.now() / 1000);
    const since = Math.max(now - 24 * 3600, this.marketNewestTs - 600);
    // Paint the feed from the last snapshot before the relay backfill lands, so
    // the first render isn't built event-by-event. Only on a fresh subscribe
    // (empty feed) — a resume already has the in-memory feed.
    this.feedKey = FEED_STORE_PREFIX + [...markets].sort().join(',');
    if (this.marketIntents.size === 0) void this.hydrateFeed(this.feedKey, now - FEED_MAX_AGE_SECONDS);
    const sub = this.pool.subscribeMany(
      this.relays,
      {
        kinds: [KIND_INTENT_OFFER, KIND_INTENT_REQUEST],
        '#t': markets,
        since,
      },
      {
        onevent: (ev: Event) => {
          if (ev.created_at > this.marketNewestTs) this.marketNewestTs = ev.created_at;
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
          this.persistFeedSoon();
          this.flushPending(intent.id); // a deal's DM may have been waiting on this intent
          this.onIntent?.(intent);
          this.fetchProfile(intent.pubkey);
          this.fetchReputation(intent.pubkey);
          // Only look for a shared-group signal once the viewer belongs to any
          // group — otherwise there's nothing to match against.
          if (this.myGroupGids.size > 0) this.fetchPeerGroups(intent.pubkey);
          if (++this.intentsSincePrune >= PRUNE_EVERY_INTENTS) this.pruneSessionCaches();
        },
      },
    );
    return () => {
      sub.close();
      if (this.feedPersistTimer) { clearTimeout(this.feedPersistTimer); this.feedPersistTimer = null; }
      void this.persistFeedNow();
    };
  }

  /** Populate the feed from the last snapshot for `key`, skipping stale (older
   *  than the live window), own, or already-present intents. Each survivor goes
   *  through onIntent, which the app coalesces into a single render. */
  private async hydrateFeed(key: string, since: number): Promise<void> {
    try {
      const raw = await kvCacheGet(key);
      if (!raw) return;
      const arr = JSON.parse(raw) as Intent[];
      for (const intent of arr) {
        if (!intent?.id || !intent.d || !intent.pubkey) continue;
        if (intent.createdAt < since) continue;           // beyond the live window
        if (intent.pubkey === this.pubkey) continue;      // own posts restore via `published`
        if (this.marketIntents.has(intent.id)) continue;  // live backfill already delivered it
        this.marketIntents.set(intent.id, intent);
        this.onIntent?.(intent);
      }
    } catch { /* ignore a corrupt/absent snapshot */ }
  }

  /** Debounced snapshot write (feed churns fast during a backfill). */
  private persistFeedSoon(): void {
    if (this.feedPersistTimer) return;
    this.feedPersistTimer = setTimeout(() => { this.feedPersistTimer = null; void this.persistFeedNow(); }, 3000);
  }

  private async persistFeedNow(): Promise<void> {
    if (!this.feedKey) return;
    try {
      const cutoff = Math.floor(Date.now() / 1000) - FEED_MAX_AGE_SECONDS;
      let arr = [...this.marketIntents.values()].filter((i) => i.createdAt >= cutoff && i.pubkey !== this.pubkey);
      arr.sort((a, b) => b.createdAt - a.createdAt);
      if (arr.length > FEED_MAX) arr = arr.slice(0, FEED_MAX);
      await kvCacheSet(this.feedKey, JSON.stringify(arr));
    } catch { /* best-effort */ }
  }

  /**
   * Profile fetches are BATCHED: the startup backfill delivers a burst of
   * intents from many distinct authors, and one REQ per author (the old
   * behavior) blows through relays' per-socket subscription caps — most
   * queries queue or get dropped, delaying the feed itself. Collect unknown
   * pubkeys for a beat and issue a single `{kinds:[0], authors:[…]}` REQ.
   */
  /**
   * Session caches grew monotonically: on a web/PWA session left open for
   * days on a busy market, marketIntents retained every full parsed payload
   * ever seen, profiles/reputations never evicted, and the per-author listing
   * cap kept counting expired d-tags — silently hiding an active poster's
   * NEWER listings once five old ones had ever been seen. Prune periodically.
   */
  private intentsSincePrune = 0;

  private pruneSessionCaches(): void {
    this.intentsSincePrune = 0;
    const now = Math.floor(Date.now() / 1000);
    for (const [id, intent] of this.marketIntents) {
      if (intent.content.expires_at <= now) this.marketIntents.delete(id);
    }
    // Cap what's left (oldest-inserted evicted first — Map preserves order).
    for (const id of this.marketIntents.keys()) {
      if (this.marketIntents.size <= MAX_MARKET_INTENTS) break;
      this.marketIntents.delete(id);
    }
    // Rebuild the per-author listing cap from LIVE intents only, so expired/
    // withdrawn listings stop occupying an author's five slots.
    this.authorListings.clear();
    for (const intent of this.marketIntents.values()) {
      let seen = this.authorListings.get(intent.pubkey);
      if (!seen) { seen = new Set(); this.authorListings.set(intent.pubkey, seen); }
      seen.add(intent.d);
    }
    for (const cache of [this.profiles, this.reputations, this.profileTs, this.peerGroups] as Map<string, unknown>[]) {
      for (const k of cache.keys()) {
        if (cache.size <= MAX_PEER_CACHE) break;
        cache.delete(k);
      }
    }
  }

  private profileFetchQueue = new Set<string>();
  private profileFetchTimer: ReturnType<typeof setTimeout> | null = null;
  /** created_at of the applied kind-0 per pubkey — relays echo old versions. */
  private profileTs = new Map<string, number>();

  private fetchProfile(pubkey: string): void {
    if (this.profiles.has(pubkey)) return;
    this.profiles.set(pubkey, {}); // mark as in-flight
    this.profileFetchQueue.add(pubkey);
    if (this.profileFetchTimer) return;
    this.profileFetchTimer = setTimeout(() => {
      this.profileFetchTimer = null;
      const authors = [...this.profileFetchQueue];
      this.profileFetchQueue.clear();
      if (!authors.length) return;
      const sub = this.pool.subscribeMany(
        this.relays,
        { kinds: [0], authors },
        {
          onevent: (ev: Event) => {
            // Keep only the NEWEST kind-0 per author — with several relays in
            // the pool, stale profile versions arrive in arbitrary order.
            if ((this.profileTs.get(ev.pubkey) ?? 0) >= ev.created_at) return;
            try {
              const meta = JSON.parse(ev.content);
              this.profileTs.set(ev.pubkey, ev.created_at);
              this.profiles.set(ev.pubkey, { name: meta.name, picture: meta.picture, about: meta.about, phone: meta.phone, vehicleModel: meta.vehicle_model, plate: meta.plate, lud16: meta.lud16, link: meta.link || (httpsLinkOrNull(meta.website) ?? undefined) });
              this.onProfileFetched?.(ev.pubkey);
            } catch {}
          },
          oneose: () => sub.close(),
        },
      );
    }, 400);
  }

  /**
   * Reputation fetches are THROTTLED, not batched: each one is ~6 relay
   * queries (receipts both directions, karma, activity, partner receipts), so
   * a backfill burst of N authors used to fire ~6×N REQs at once. A small
   * concurrency gate keeps the relay connections responsive; the feed's
   * karma sort updates progressively as results land (as it already did).
   */
  private reputationInFlight = new Set<string>();
  private reputationWaiting: string[] = [];
  private static readonly REPUTATION_CONCURRENCY = 3;

  fetchReputation(pubkey: string): void {
    if (this.reputations.has(pubkey) || this.reputationInFlight.has(pubkey) || this.reputationWaiting.includes(pubkey)) return;
    if (this.reputationInFlight.size >= MobileClient.REPUTATION_CONCURRENCY) {
      this.reputationWaiting.push(pubkey);
      return;
    }
    this.runReputationFetch(pubkey);
  }

  private runReputationFetch(pubkey: string): void {
    this.reputationInFlight.add(pubkey);
    this.trust()
      .then((trust) => fetchReputation(this.pool, this.relays, pubkey, trust))
      .then((rep) => {
        this.reputations.set(pubkey, rep);
        this.onReputationFetched?.(pubkey);
      })
      .catch(() => {})
      .finally(() => {
        this.reputationInFlight.delete(pubkey);
        const next = this.reputationWaiting.shift();
        if (next) this.runReputationFetch(next);
      });
  }

  // ─── Group import / community onboarding ─────────────────────────────────

  /** Sign a group-invite event (the admin-signed community descriptor). The
   *  event id becomes the immutable group id; the whole event is later encoded
   *  into the share link. A random `nonce` tag guarantees a unique id even for
   *  two invites with identical descriptors created in the same second. */
  async signGroupInvite(descriptor: GroupDescriptor): Promise<Event> {
    const rnd = new Uint8Array(8);
    globalThis.crypto.getRandomValues(rnd);
    const nonce = [...rnd].map((b) => b.toString(16).padStart(2, '0')).join('');
    return this.signer.signEvent({
      kind: KIND_GROUP_INVITE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', nonce], ['nonce', nonce]],
      content: JSON.stringify(descriptor),
    });
  }

  /** Publish a member's join attestation (addressable by d = group id). The
   *  content embeds the admin-signed invite so any reader can verify it. */
  async publishGroupJoin(invite: GroupInvite): Promise<void> {
    const ev = await this.signer.signEvent({
      kind: KIND_GROUP_JOIN,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', invite.gid], ['p', invite.admin]],
      content: makeGroupJoinContent(invite),
    });
    await Promise.any(this.pool.publish(this.relays, ev));
  }

  private groupsInFlight = new Set<string>();
  /** Lazily fetch + cache a peer's VERIFIED group-join attestations. Best-effort
   *  and throttled by an in-flight guard; fires onReputationFetched so cards
   *  re-render with the "Same group" badge once results land. */
  fetchPeerGroups(pubkey: string): void {
    if (this.peerGroups.has(pubkey) || this.groupsInFlight.has(pubkey)) return;
    this.groupsInFlight.add(pubkey);
    query(this.pool, this.relays, { kinds: [KIND_GROUP_JOIN], authors: [pubkey], limit: 50 })
      .then((events) => {
        const groups: GroupInvite[] = [];
        const seen = new Set<string>();
        for (const ev of events) {
          const inv = parseGroupJoin(ev.content);
          // A join only counts if the ATTESTER is the event author (no relaying
          // someone else's membership) and the gid isn't already recorded.
          if (inv && !seen.has(inv.gid)) { seen.add(inv.gid); groups.push(inv); }
        }
        this.peerGroups.set(pubkey, groups);
        this.onReputationFetched?.(pubkey);
      })
      .catch(() => {})
      .finally(() => { this.groupsInFlight.delete(pubkey); });
  }

  /** List members who published a join attestation for `gid` (admin members
   *  screen). Verified against the embedded admin signature. */
  async fetchGroupMembers(gid: string): Promise<{ pubkey: string; name?: string }[]> {
    const events = await query(this.pool, this.relays, { kinds: [KIND_GROUP_JOIN], '#d': [gid], limit: 500 });
    const members = new Map<string, number>(); // pubkey → newest created_at
    for (const ev of events) {
      const inv = parseGroupJoin(ev.content);
      if (!inv || inv.gid !== gid) continue; // must reference this exact group
      const prev = members.get(ev.pubkey) ?? 0;
      if (ev.created_at >= prev) members.set(ev.pubkey, ev.created_at);
    }
    return [...members.keys()]
      .filter((pk) => pk !== this.pubkey)
      .map((pk) => ({ pubkey: pk, name: this.profiles.get(pk)?.name }));
  }

  /** Admin one-tap vouch for a group member. Reuses the karma event format but
   *  keys it on the group id (d = `grp:<gid>`), NOT a deal — so it is a visible
   *  signal that does NOT inflate the trust-weighted score (which only counts
   *  karma backed by a proven deal-receipt pair). */
  async publishGroupVouch(member: string, gid: string, note?: string): Promise<void> {
    const content: { v: number; score: KarmaScore; note?: string } = { v: SCHEMA_VERSION, score: 2 };
    if (note) content.note = note;
    const ev = await this.signer.signEvent({
      kind: KIND_KARMA,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', `grp:${gid}`], ['p', member]],
      content: JSON.stringify(content),
    });
    await Promise.any(this.pool.publish(this.relays, ev));
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
      // Future expiration (not `now`): a born-expired event (expiration <= now) is
      // rejected/instantly dropped by NIP-40 relays, so the withdrawal would never
      // propagate and other browsers (Provider C) keep seeing the filled intent.
      // Same TTL the manual withdrawIntent uses; our clients hide it now via `withdrawn`.
      expiresAt: now + WITHDRAW_TTL_SECONDS,
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

  /**
   * Watch storefront products (NIP-15 kind 30018) on our market tags.
   * Addressable: a newer event per (pubkey, d) replaces the older one; a
   * TOMBSTONE (empty content) removes the product from the map.
   */
  watchShops(market: string | string[]): () => void {
    const markets = Array.isArray(market) ? market : [market];
    const sub = this.pool.subscribeMany(
      this.relays,
      { kinds: [KIND_PRODUCT], '#t': markets },
      {
        onevent: (ev: Event) => {
          const d = ev.tags.find((t) => t[0] === 'd')?.[1];
          if (!d) return;
          const key = ev.pubkey + '|' + d;
          const cur = this.products.get(key);
          if (cur && cur.createdAt >= ev.created_at) return; // stale replay
          const product = parseProductEvent(ev);
          if (!product) {
            // Tombstone (or junk) NEWER than what we show — drop the listing.
            if (cur) {
              this.products.delete(key);
              this.onProductRemoved?.(ev.pubkey, d);
            }
            return;
          }
          if (!screenIntentContent('service/1', product.content.name, { notes: product.content.description }).allowed) return;
          this.products.set(key, product);
          this.fetchProfile(product.pubkey);
          this.onProduct?.(product);
        },
      },
    );
    return () => sub.close();
  }

  /** Publish (or edit — same d) one of OUR products. */
  async publishProduct(input: BuildProductInput): Promise<Product> {
    const verdict = screenIntent(undefined, input.name, undefined, input.description);
    if (!verdict.allowed) throw new Error(verdict.reason ?? 'This listing is not allowed.');
    const tmpl = buildProductTemplate(input);
    const ev = await this.signer.signEvent({ kind: tmpl.kind, created_at: tmpl.created_at, tags: tmpl.tags, content: tmpl.content });
    const product = parseProductEvent(ev)!;
    this.products.set(product.pubkey + '|' + product.d, product);
    await Promise.any(this.pool.publish(this.relays, ev));
    this.onProduct?.(product);
    return product;
  }

  /** Remove one of OUR products (tombstone its d-tag). */
  async removeProduct(d: string, market: string): Promise<void> {
    const tmpl = buildProductRemovalTemplate(d, market);
    const ev = await this.signer.signEvent({ kind: tmpl.kind, created_at: tmpl.created_at, tags: tmpl.tags, content: tmpl.content });
    this.products.delete(this.pubkey + '|' + d);
    await Promise.any(this.pool.publish(this.relays, ev));
    this.onProductRemoved?.(this.pubkey, d);
  }

  /** Replace the set of blocked peer pubkeys (hex). Inbound DMs from them are dropped. */
  setBlocked(pubkeys: Iterable<string>): void {
    this.blocked = new Set(pubkeys);
  }

  watchDMs(): () => void {
    this.watchStartTs = Math.floor(Date.now() / 1000);
    // Disappearing messages expire on a timer, not only on events.
    const sweepTimer = setInterval(() => this.sweepExpiredMessages(), 60_000);
    // Backfill from just behind the newest DM we've already processed (with a
    // reorder margin) instead of always 7 days — for a daily user that's ~7×
    // fewer NIP-04 decrypts and replays per launch/resume. The event-id replay
    // guard makes any overlap harmless.
    const floor = Math.floor(Date.now() / 1000) - DM_BACKFILL_MAX_SECONDS;
    const since = Math.max(floor, this.dmLastSeenTs - DM_BACKFILL_MARGIN_SECONDS);
    // SimplePool.subscribeMany takes ONE filter (an array here once slipped
    // through behind an `as any` and silently killed ALL DM delivery on
    // updated clients — the type error was real). Kind 4 and the NIP-17
    // kind-1059 wraps are therefore two separate subscriptions; the 1059 one
    // reaches 2 days further back because wrap timestamps are randomized
    // into the past, and rumor-id replay guards make the overlap harmless.
    const dmSub = this.pool.subscribeMany(
      this.relays,
      { kinds: [4], '#p': [this.pubkey], since },
      {
        onevent: async (ev: Event) => {
          if (ev.created_at > this.dmLastSeenTs && ev.created_at <= this.watchStartTs + 300) {
            this.dmLastSeenTs = ev.created_at;
            void this.persistNegotiations(); // debounced; also writes dmLastSeen
          }
          if (this.blocked.has(ev.pubkey)) return; // blocked peer — drop without decrypting
          try {
            const plain = await this.signer.nip04Decrypt(ev.pubkey, ev.content);
            this.routePlaintext(plain, ev.pubkey, ev.created_at, ev.id);
          } catch {
            /* not a Freeport DM */
          }
        },
      },
    );
    const wrapSub = this.nip17Supported()
      ? this.pool.subscribeMany(
          this.relays,
          { kinds: [1059], '#p': [this.pubkey], since: since - 2 * 24 * 3600 },
          { onevent: (ev: Event) => this.enqueueWrap(ev) },
        )
      : null;
    return () => { clearInterval(sweepTimer); dmSub.close(); wrapSub?.close(); this.wrapQueue = []; };
  }

  private commitEscrow(escrow: EscrowState): void {
    this.escrows.set(escrow.nego, escrow);
    if (!this.escrowPersistTimer) {
      this.escrowPersistTimer = setTimeout(() => {
        this.escrowPersistTimer = null;
        kvCacheSet(ESCROW_STORE_KEY, JSON.stringify([...this.escrows.values()])).catch(() => {});
      }, 250);
    }
    this.onEscrowUpdate?.(escrow);
  }

  async loadEscrows(): Promise<void> {
    try {
      const raw = await kvCacheGet(ESCROW_STORE_KEY);
      if (!raw) return;
      for (const e of JSON.parse(raw) as EscrowState[]) {
        if (!e?.nego) continue;
        this.escrows.set(e.nego, e);
        this.onEscrowUpdate?.(e);
      }
    } catch { /* corrupt/absent → start empty */ }
  }

  /**
   * Buyer: start an escrow on a confirmed deal. Generates the preimage HERE
   * (it never leaves this device until release), sends the hash + amount to
   * the seller, who answers with a hold invoice.
   */
  async requestEscrow(negoId: string, amountSats: number): Promise<void> {
    const nego = this.negotiations.get(negoId);
    if (!nego || !nego.peer || amountSats <= 0) return;
    if (this.escrows.has(negoId)) return; // one escrow per deal
    const rnd = new Uint8Array(32);
    globalThis.crypto.getRandomValues(rnd);
    const preimage = [...rnd].map((b) => b.toString(16).padStart(2, '0')).join('');
    const hash = [...sha256(rnd)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const escrow: EscrowState = {
      nego: negoId, peer: nego.peer, role: 'buyer', hash, preimage,
      amountSats: Math.round(amountSats), status: 'requested', updatedAt: Math.floor(Date.now() / 1000),
    };
    this.commitEscrow(escrow);
    await this.sendDM(nego.peer, JSON.stringify(makeEscrowRequest(negoId, hash, escrow.amountSats)));
  }

  /** Seller: accept the request — create the hold invoice and send it back. */
  async acceptEscrow(negoId: string): Promise<void> {
    const escrow = this.escrows.get(negoId);
    if (!escrow || escrow.role !== 'seller' || escrow.status !== 'requested') return;
    const wallet = await this.getEscrowWallet?.();
    if (!wallet?.createHoldInvoice) throw new Error('wallet unavailable');
    const invoice = await wallet.createHoldInvoice(escrow.amountSats, 'Freeport escrow', escrow.hash, ESCROW_EXPIRY_SECONDS);
    this.commitEscrow({ ...escrow, invoice, status: 'invoiced', updatedAt: Math.floor(Date.now() / 1000) });
    await this.sendDM(escrow.peer, JSON.stringify(makeEscrowInvoice(negoId, escrow.hash, invoice)));
  }

  /** Buyer: reveal the preimage on delivery — the seller can now settle. */
  async releaseEscrow(negoId: string): Promise<void> {
    const escrow = this.escrows.get(negoId);
    if (!escrow || escrow.role !== 'buyer' || !escrow.preimage) return;
    this.commitEscrow({ ...escrow, status: 'released', updatedAt: Math.floor(Date.now() / 1000) });
    await this.sendDM(escrow.peer, JSON.stringify(makeEscrowRelease(negoId, escrow.hash, escrow.preimage)));
  }

  /** Seller: (re)try settling with the revealed preimage. */
  async claimEscrow(negoId: string): Promise<void> {
    const escrow = this.escrows.get(negoId);
    if (!escrow || escrow.role !== 'seller' || !escrow.preimage) return;
    try {
      const wallet = await this.getEscrowWallet?.();
      if (!wallet?.claimHtlc) throw new Error('wallet unavailable');
      await wallet.claimHtlc(escrow.preimage);
      this.commitEscrow({ ...escrow, status: 'settled', updatedAt: Math.floor(Date.now() / 1000) });
    } catch {
      this.commitEscrow({ ...escrow, status: 'claim_failed', updatedAt: Math.floor(Date.now() / 1000) });
    }
  }

  /** Inbound escrow envelope — strict peer + hash checks, replay-safe. */
  private processEscrowDM(env: EscrowEnvelope, from: string, eventId?: string): void {
    const existing = this.escrows.get(env.nego);
    if (existing) {
      if (from !== existing.peer) return; // third party injecting into the escrow
      if (eventId && existing.seenEventIds?.includes(eventId)) return;
      if (env.hash !== existing.hash) return; // wrong lock
    }
    const seen = (e: EscrowState): EscrowState =>
      eventId ? { ...e, seenEventIds: [...(existing?.seenEventIds ?? []).slice(-99), eventId] } : e;
    const now = Math.floor(Date.now() / 1000);
    if (env.type === ESCROW_REQUEST) {
      if (existing) return; // duplicate request
      const nego = this.negotiations.get(env.nego);
      if (!nego || from !== nego.peer) return; // escrow only on OUR deals, from the counterparty
      this.commitEscrow(seen({
        nego: env.nego, peer: from, role: 'seller', hash: env.hash,
        amountSats: Math.round(env.amount_sats!), status: 'requested', updatedAt: now,
      }));
      return;
    }
    if (!existing) return; // invoice/release without a request — drop
    if (env.type === ESCROW_INVOICE) {
      if (existing.role !== 'buyer' || existing.status !== 'requested') return;
      this.commitEscrow(seen({ ...existing, invoice: env.invoice, status: 'invoiced', updatedAt: now }));
      return;
    }
    if (env.type === ESCROW_RELEASE) {
      if (existing.role !== 'seller') return;
      // The preimage must actually open the lock — verify before touching the wallet.
      const bytes = new Uint8Array(env.preimage!.match(/../g)!.map((h) => parseInt(h, 16)));
      const check = [...sha256(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (check !== existing.hash) return;
      if (existing.status === 'settled') return; // replayed release after settling
      this.commitEscrow(seen({ ...existing, preimage: env.preimage, status: 'released', updatedAt: now }));
      // Settle automatically; claim_failed keeps a Retry button in the UI.
      void this.claimEscrow(env.nego);
    }
  }

  /** Route one decrypted plaintext through the four envelope families. */
  private routePlaintext(plain: string, from: string, createdAt: number, eventId?: string): void {
    const msg = parseNegotiationMessage(plain);
    if (msg) {
      this.processDM(msg, from, createdAt, false, eventId);
      return;
    }
    // Not a negotiation envelope — try the friend-chat family. Parsed here
    // (never via pendingMsgs) so a chat DM can't queue forever waiting on an
    // intent that doesn't exist.
    const chat = parseChatEnvelope(plain);
    if (chat) {
      this.processChatDM(chat, from, createdAt, eventId);
      return;
    }
    const call = parseCallEnvelope(plain);
    if (call) {
      this.processCallDM(call, from, createdAt);
      return;
    }
    const escrow = parseEscrowEnvelope(plain);
    if (escrow) this.processEscrowDM(escrow, from, eventId);
  }

  /**
   * Unwrap a kind-1059 gift wrap → the inner rumor is the real message:
   * sender = rumor.pubkey (the wrap's is ephemeral), time = rumor.created_at
   * (the wrap's is randomized), id = rumor.id (shared with the sender's
   * outbound record). The blocked check must run AFTER unwrap — the wrap's
   * author is a throwaway key by design.
   */
  /**
   * Enqueue a gift wrap and kick the drainer. Cheap and synchronous so the
   * relay callback returns immediately; the expensive unwrap happens in
   * drainWraps, spread across macrotasks.
   */
  /** Override how the first wrap-drain of a burst is scheduled (see wrapKick). */
  setWrapKick(fn: (cb: () => void) => void): void { this.wrapKick = fn; }

  private enqueueWrap(ev: Event): void {
    this.wrapQueue.push(ev);
    if (!this.wrapDraining) {
      this.wrapDraining = true;
      this.wrapKick(() => this.drainWraps());
    }
  }

  /**
   * Process a small batch of queued wraps, then yield the JS thread before the
   * next batch so the UI (and relay I/O) stays responsive during the connect
   * backfill burst. Drains to empty, re-scheduling itself with setTimeout(0).
   */
  private drainWraps(): void {
    const BATCH = 2;
    for (let i = 0; i < BATCH; i++) {
      const ev = this.wrapQueue.shift();
      if (!ev) { this.wrapDraining = false; return; }
      this.processWrap(ev);
    }
    if (this.wrapQueue.length) setTimeout(() => this.drainWraps(), 0);
    else this.wrapDraining = false;
  }

  private processWrap(ev: Event): void {
    try {
      const rumor = this.unwrapVerified(ev);
      if (!rumor?.pubkey || typeof rumor.content !== 'string') return;
      if (rumor.pubkey === this.pubkey) return; // our own outbound copy
      if (this.blocked.has(rumor.pubkey)) return;
      this.routePlaintext(rumor.content, rumor.pubkey, rumor.created_at, rumor.id);
    } catch {
      /* not addressed to us / junk / FORGED wrap — dropped */
    }
  }

  /**
   * Unwrap a NIP-59 gift wrap with the sender check nostr-tools' `unwrapEvent`
   * omits. `unwrapEvent` is just two NIP-44 decrypts — it never verifies the
   * seal's signature nor that the inner rumor's author matches the seal's
   * author, so anyone could forge a rumor `pubkey` of a trusted contact and
   * have it routed as an authenticated message (chat, negotiation, escrow).
   *
   * Here: (1) decrypt the wrap → seal, (2) `verifyEvent(seal)` so the seal is
   * genuinely signed by `seal.pubkey`, (3) decrypt the seal → rumor, (4) require
   * `rumor.pubkey === seal.pubkey`. Only then is the rumor author authenticated.
   * Throws on any failure; the caller drops the wrap.
   */
  private unwrapVerified(wrap: Event): Event {
    const sk = this.signer.secretKey!;
    const seal = JSON.parse(nip44Decrypt(wrap.content, nip44ConvKey(sk, wrap.pubkey))) as Event;
    if (!seal?.pubkey || !verifyEvent(seal)) throw new Error('bad seal');
    const rumor = JSON.parse(nip44Decrypt(seal.content, nip44ConvKey(sk, seal.pubkey))) as Event;
    if (rumor?.pubkey !== seal.pubkey) throw new Error('rumor/seal author mismatch');
    return rumor;
  }

  /**
   * Apply one decrypted negotiation DM. If its intent isn't loaded yet, queue it
   * (see pendingMsgs) and replay later via flushPending — so a deal isn't lost
   * when the accept backfill races ahead of the own-post echo, or the post just
   * expired. `replay` marks a queued message so it isn't re-queued forever.
   */
  private processDM(msg: NegotiationMessage, from: string, createdAt: number, replay = false, eventId?: string): void {
    if (this.blocked.has(from)) return; // blocked peer — drop (also covers replayed/pending DMs)
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
    // Our intent is already filled? Reject a late/racing accept OR counter
    // from a losing bidder instead of opening a second deal (accept) or a
    // dangling open negotiation the sweep already missed (counter — the sweep
    // runs at confirm time, so a bid arriving after it was never cancelled).
    if (
      (msg.type === MSG_ACCEPT || msg.type === MSG_COUNTER) &&
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
    if (!updated) {
      // A DUPLICATE inbound accept on a confirmed deal is the peer poking:
      // they still haven't received our contact. Re-send it (idempotent on
      // their side); without a contact of our own yet, nudge the app so its
      // back-flow effect runs. Heals deals stranded by a lost accept DM.
      if (msg.type === MSG_ACCEPT && nego.state === 'confirmed' && createdAt >= this.watchStartTs - 5) {
        if (nego.ourContact) {
          this.resolvePayAddress()
            .then((pa) => this.sendDM(nego.peer, JSON.stringify(makeAccept(nego, nego.ourContact!, pa))))
            .catch(() => {});
        } else {
          this.onNegotiationUpdate?.(nego);
        }
      }
      return;
    }
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
    // One typed view of the free-form payload instead of per-field `as any`
    // casts — an `as any` in this file once silently killed all DM delivery.
    const p = (input.payload ?? {}) as Partial<{
      category: string; service: string; notes: string; note: string; subcategory: string;
      from: { name?: string }; to: { name?: string }; location: { name?: string };
    }>;
    const verdict = screenIntent(
      p.category,
      input.title,
      p.service,
      p.notes,
      p.note,
      p.from?.name,
      p.to?.name,
      p.location?.name,
      p.subcategory,
    );
    if (!verdict.allowed) throw new Error(verdict.reason ?? 'This listing is not allowed.');
    if (profile && (profile.name || profile.picture || profile.about || profile.phone)) {
      // Fire-and-forget: profile publish is best-effort, don't block posting
      publishProfile(this.signer, profile, this.relays).catch(() => {});
    }
    // Mine NIP-13 PoW so each post carries a CPU cost (anti-spam). The nonce
    // tag is preserved through signing, so the published id keeps its PoW.
    const tmpl = buildIntentTemplate(input);
    let mined: typeof tmpl & { pubkey: string } = { ...tmpl, pubkey: this.signer.pubkey };
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
  /** Best-effort wallet address for makeAccept — bounded so a slow wallet
   *  boot (web WASM download) can never stall sealing a deal. */
  private async resolvePayAddress(): Promise<string | undefined> {
    if (!this.getPayAddress) return undefined;
    try {
      const addr = await Promise.race([
        this.getPayAddress(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      return addr || undefined;
    } catch {
      return undefined;
    }
  }

  async acceptIntent(intent: Intent, terms: ProposedTerms, contact: string): Promise<string | null> {
    const base = openNegotiation(intent, this.pubkey, true, intent.pubkey);
    if (this.negotiations.has(base.id)) return null;
    // Terms originate from the intent owner ("them"); seating them lets
    // makeAccept (which accepts `nego.terms`) build a valid confirming message.
    const seeded: Negotiation = { ...base, terms, termsBy: 'them' };
    const msg = makeAccept(seeded, contact, await this.resolvePayAddress());
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
    const msg = makeAccept(nego, contact, await this.resolvePayAddress());
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

  // ─── Friend chat (experimental) ────────────────────────────────────────────

  setChatPrefs(prefs: { receipts: boolean; lastSeen: boolean }): void {
    this.chatPrefs = prefs;
  }

  private commitConversation(conv: Conversation): void {
    this.conversations.set(conv.peer, conv);
    this.persistConversations();
  }

  private persistConversations(): void {
    if (this.chatPersistTimer) return;
    this.chatPersistTimer = setTimeout(() => {
      this.chatPersistTimer = null;
      kvCacheSet(CHAT_STORE_KEY, JSON.stringify([...this.conversations.values()])).catch(() => {});
    }, 250);
  }

  async loadConversations(): Promise<void> {
    try {
      const raw = await kvCacheGet(CHAT_STORE_KEY);
      if (!raw) return;
      for (const conv of JSON.parse(raw) as Conversation[]) {
        if (!conv?.peer) continue;
        this.conversations.set(conv.peer, conv);
        this.fetchProfile(conv.peer); // avatar + display name for the row
        this.onConversationUpdate?.(conv);
      }
      this.sweepExpiredMessages(); // disappearing messages expire across restarts too
    } catch { /* corrupt/absent → start empty */ }
  }

  /** Apply one decrypted inbound chat envelope (see conversations.ts). */
  private processChatDM(env: ChatEnvelope, from: string, createdAt: number, eventId?: string): void {
    if (this.blocked.has(from)) return;
    const updated = applyChatInbound(this.conversations.get(from), env, from, eventId);
    if (!updated) return;
    this.commitConversation(updated);
    this.fetchProfile(from); // avatar + kind:0 name for the chat row
    this.onConversationUpdate?.(updated);
    // Live-only side effects — never for the startup backfill replay.
    if (createdAt < this.watchStartTs - 5) return;
    if (env.type === CHAT_INVITE || env.type === CHAT_MSG) this.onIncomingChat?.(updated, env);
    if (env.type === CHAT_MSG && updated.state === 'active') this.queueDeliveredAck(from, env.ts);
  }

  /** Coalesced delivered-receipt: one ack covers a burst of inbound messages. */
  private queueDeliveredAck(peer: string, ts: number): void {
    if (!this.chatPrefs.receipts) return;
    this.ackMax.set(peer, Math.max(this.ackMax.get(peer) ?? 0, ts));
    if (this.ackTimers.has(peer)) return;
    this.ackTimers.set(peer, setTimeout(() => {
      this.ackTimers.delete(peer);
      const upTo = this.ackMax.get(peer) ?? 0;
      this.ackMax.delete(peer);
      this.sendChatEnvelope(peer, makeChatAck('delivered', upTo, this.lastSeenNow())).catch(() => {});
    }, CHAT_ACK_DELAY_MS));
  }

  private lastSeenNow(): number | undefined {
    return this.chatPrefs.lastSeen ? Math.floor(Date.now() / 1000) : undefined;
  }

  /** We can gift-wrap iff we hold the raw key (local signer; not NIP-07). */
  private nip17Supported(): boolean {
    return !!this.signer.secretKey;
  }

  /**
   * NIP-17 send: kind-14 rumor (our JSON envelope as content) → seal → wrap.
   * Returns the RUMOR id — the wrap id differs per recipient and its
   * timestamp is randomized, so the rumor id is the shared message identifier
   * both sides use for replies/reactions/dedupe.
   */
  private async sendWrapped(peer: string, plaintext: string): Promise<string> {
    const sk = this.signer.secretKey!;
    const rumor = createRumor(
      { kind: 14, created_at: Math.floor(Date.now() / 1000), tags: [['p', peer]], content: plaintext },
      sk,
    );
    const wrap = createWrap(createSeal(rumor, sk, peer), peer);
    await this.publishDM(wrap as Event);
    return rumor.id;
  }

  /**
   * Post-handshake chat traffic upgrades to gift wrap when BOTH sides can
   * (the handshake itself always rides NIP-04 so it reaches every client —
   * capability is exchanged via the invite/accept `n17` flag).
   */
  private async sendChatEnvelope(peer: string, env: ChatEnvelope): Promise<string> {
    const handshake = env.type === CHAT_INVITE || env.type === CHAT_ACCEPT || env.type === CHAT_REJECT;
    const plaintext = JSON.stringify(env);
    if (!handshake && this.nip17Supported() && this.conversations.get(peer)?.nip17) {
      return this.sendWrapped(peer, plaintext);
    }
    return this.sendDM(peer, plaintext);
  }

  /**
   * Route an inbound call envelope. Calls are ephemeral: nothing here
   * persists, and the guards are strict because a stale ring is worse than a
   * missed one — the DM backfill replays the whole recent window on every
   * launch/resume.
   */
  private processCallDM(env: CallEnvelope, from: string, createdAt: number): void {
    if (this.blocked.has(from)) return;
    if (this.conversations.get(from)?.state !== 'active') return; // handshake first — the call spam gate
    if (createdAt < this.watchStartTs - 5) return;                // backfill replay — never ring old offers
    if (env.type === CALL_OFFER && !callOfferFresh(env)) return;  // relay-delayed offer past its TTL
    this.onCallSignal?.(from, env);
  }

  /** Send one call-signaling envelope (offer/answer/hangup) to a peer —
   *  gift-wrapped when the conversation upgraded to NIP-17. */
  async sendCallSignal(peer: string, env: CallEnvelope): Promise<void> {
    const plaintext = JSON.stringify(env);
    if (this.nip17Supported() && this.conversations.get(peer)?.nip17) {
      await this.sendWrapped(peer, plaintext);
      return;
    }
    await this.sendDM(peer, plaintext);
  }

  /** Send a chat request to a resolved invite's pubkey (opener side). */
  async chatInvite(peer: string, myName?: string): Promise<void> {
    const env = makeChatInvite(myName, await this.resolvePayAddress(), this.nip17Supported());
    const conv = applyChatOutbound(
      this.conversations.get(peer) ?? newConversation(peer, 'pending_out'),
      env,
    );
    this.commitConversation(conv);
    this.onConversationUpdate?.(conv);
    await this.sendChatEnvelope(peer, env);
  }

  /** Accept a pending incoming chat request. */
  async chatAccept(peer: string, myName?: string): Promise<void> {
    const conv = this.conversations.get(peer);
    if (!conv || conv.state !== 'pending_in') return;
    const env = makeChatAccept(myName, await this.resolvePayAddress(), this.nip17Supported());
    const updated = applyChatOutbound(conv, env);
    this.commitConversation(updated);
    this.onConversationUpdate?.(updated);
    await this.sendChatEnvelope(peer, env);
  }

  /** Reject a pending incoming chat request — the conversation is dropped. */
  async chatReject(peer: string): Promise<void> {
    const conv = this.conversations.get(peer);
    if (!conv || conv.state !== 'pending_in') return;
    this.conversations.delete(peer);
    kvCacheSet(CHAT_STORE_KEY, JSON.stringify([...this.conversations.values()])).catch(() => {});
    this.onConversationUpdate?.({ ...conv, state: 'rejected' });
    await this.sendChatEnvelope(peer, makeChatReject());
  }

  /** Send a friend-chat message (active conversation). Send-then-commit so
   *  the stored message carries the DM event id (reply/reaction target). */
  async chatSend(peer: string, text: string, opts?: { replyTo?: string; quote?: string }): Promise<void> {
    const conv = this.conversations.get(peer);
    if (!conv || conv.state !== 'active' || !text.trim()) return;
    const env = makeChatMsg(text.trim(), { ...opts, expiresIn: conv.disappearTtl });
    const id = await this.sendChatEnvelope(peer, env);
    const cur = this.conversations.get(peer) ?? conv; // may have advanced while sending
    const updated = applyChatOutbound(cur, env, id);
    this.commitConversation(updated);
    this.onConversationUpdate?.(updated);
  }

  /** React to a message (one emoji per side; '' removes yours). */
  async chatReact(peer: string, targetId: string, emoji: string): Promise<void> {
    const conv = this.conversations.get(peer);
    if (!conv || conv.state !== 'active') return;
    const env = makeChatReact(targetId, emoji);
    const updated = applyChatOutbound(conv, env);
    this.commitConversation(updated);
    this.onConversationUpdate?.(updated);
    await this.sendChatEnvelope(peer, env);
  }

  /** Set the disappearing-messages timer (0 = off) — synced to the peer. */
  async chatSetTtl(peer: string, seconds: number): Promise<void> {
    const conv = this.conversations.get(peer);
    if (!conv || conv.state !== 'active') return;
    const env = makeChatTtl(seconds);
    const updated = applyChatOutbound(conv, env);
    this.commitConversation(updated);
    this.onConversationUpdate?.(updated);
    await this.sendChatEnvelope(peer, env);
  }

  /** Drop messages past their disappearing deadline (exact locally). */
  sweepExpiredMessages(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const conv of this.conversations.values()) {
      const swept = sweepExpired(conv, now);
      if (swept !== conv) {
        this.commitConversation(swept);
        this.onConversationUpdate?.(swept);
      }
    }
  }

  /**
   * Append a LOCAL-ONLY line to a conversation (e.g. "Missed call") — never
   * sent to the peer; it just documents a call event in the thread.
   */
  chatLocalNotice(peer: string, dir: 'in' | 'out', text: string): void {
    const conv = this.conversations.get(peer);
    if (!conv) return;
    const updated: Conversation = {
      ...conv,
      updatedAt: Math.floor(Date.now() / 1000),
      messages: [...conv.messages, { dir, text, ts: Math.floor(Date.now() / 1000) }],
    };
    this.commitConversation(updated);
    this.onConversationUpdate?.(updated);
  }

  /**
   * Presence ping — a receipt-neutral ack (up_to 0 changes no tick state)
   * carrying only last_seen. Sent while the user has this conversation OPEN,
   * so the peer's header can show "Online". Gated on the reciprocal
   * "Show last seen" toggle; never sent outside active conversations.
   */
  chatPresencePing(peer: string): void {
    if (!this.chatPrefs.lastSeen) return;
    if (this.conversations.get(peer)?.state !== 'active') return;
    this.sendChatEnvelope(peer, makeChatAck('delivered', 0, Math.floor(Date.now() / 1000))).catch(() => {});
  }

  /** Clear all messages in a conversation (local only — the peer keeps their
   *  copy). The handshake state and seenEventIds replay guard survive, so a
   *  relay backfill can't resurrect the cleared messages. */
  chatClearMessages(peer: string): void {
    const conv = this.conversations.get(peer);
    if (!conv || !conv.messages.length) return;
    const updated: Conversation = { ...conv, messages: [] };
    this.commitConversation(updated);
    this.onConversationUpdate?.(updated);
  }

  /** Delete a conversation entirely (local only — the peer isn't told).
   *  Inbound messages from this peer are now stranger messages (dropped);
   *  a replayed/new invite recreates the thread as a fresh request. */
  chatDeleteConversation(peer: string): void {
    const conv = this.conversations.get(peer);
    if (!conv) return;
    this.conversations.delete(peer);
    this.persistConversations();
    // Listeners rebuild their list from the map, which no longer holds conv.
    this.onConversationUpdate?.(conv);
  }

  /** Archive/unarchive a conversation (local only — the peer isn't told). */
  chatSetArchived(peer: string, archived: boolean): void {
    const conv = this.conversations.get(peer);
    if (!conv) return;
    const updated = { ...conv, archived };
    this.commitConversation(updated);
    this.onConversationUpdate?.(updated);
  }

  /** Mute/unmute a conversation (local only): messages still arrive, but the
   *  app skips sounds, notifications and badge counts for this peer. */
  chatSetMuted(peer: string, muted: boolean): void {
    const conv = this.conversations.get(peer);
    if (!conv) return;
    const updated = { ...conv, muted };
    this.commitConversation(updated);
    this.onConversationUpdate?.(updated);
  }

  /**
   * The user opened this conversation: advance the local read mark and, when
   * receipts are on, tell the peer (read ack, optionally with our last-seen).
   */
  markChatRead(peer: string): void {
    const conv = this.conversations.get(peer);
    if (!conv) return;
    const newestIn = conv.messages.reduce((m, x) => (x.dir === 'in' && x.ts > m ? x.ts : m), 0);
    if ((conv.myReadTs ?? 0) >= newestIn && newestIn !== 0) return; // already read up to here
    const updated = { ...conv, myReadTs: Math.max(newestIn, Math.floor(Date.now() / 1000)) };
    this.commitConversation(updated);
    this.onConversationUpdate?.(updated);
    if (this.chatPrefs.receipts && newestIn > 0 && conv.state === 'active') {
      this.sendChatEnvelope(peer, makeChatAck('read', newestIn, this.lastSeenNow())).catch(() => {});
    }
  }

  /**
   * Get-or-create the user's shareable invite. Publishing is idempotent per
   * code (addressable d-tag) and refreshes the relay-side TTL, so calling it
   * every time the invite popup opens keeps the code alive.
   */
  async publishChatInvite(name?: string): Promise<{ code: string }> {
    let stored: { code: string; nonce: string } | null = null;
    try {
      const raw = await kvGet(CHAT_INVITE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch { /* mint fresh */ }
    let invite = stored;
    if (!invite?.code || !verifyInviteCode(invite.code, this.pubkey, invite.nonce)) {
      invite = mintInviteCode(this.pubkey);
      await kvSet(CHAT_INVITE_KEY, JSON.stringify(invite));
    }
    await this.publishInviteEvent(invite.code, JSON.stringify({ v: 1, nonce: invite.nonce, ...(name ? { name } : {}) }), CHAT_INVITE_TTL_SECONDS);
    return { code: invite.code };
  }

  /** Invalidate the current invite (tombstone its d-tag) and mint a fresh one. */
  async rotateChatInvite(name?: string): Promise<{ code: string }> {
    try {
      const raw = await kvGet(CHAT_INVITE_KEY);
      const old = raw ? (JSON.parse(raw) as { code: string }) : null;
      // Same revocation mechanism as intent withdraw: republish the same d with
      // empty content and a short future expiration (born-expired is dropped).
      if (old?.code) await this.publishInviteEvent(old.code, '', WITHDRAW_TTL_SECONDS);
    } catch { /* revoking a lost invite is best-effort */ }
    const fresh = mintInviteCode(this.pubkey);
    await kvSet(CHAT_INVITE_KEY, JSON.stringify(fresh));
    await this.publishInviteEvent(fresh.code, JSON.stringify({ v: 1, nonce: fresh.nonce, ...(name ? { name } : {}) }), CHAT_INVITE_TTL_SECONDS);
    return { code: fresh.code };
  }

  private async publishInviteEvent(code: string, content: string, ttlSeconds: number): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const ev = await this.signer.signEvent({
      kind: KIND_CHAT_INVITE,
      created_at: now,
      tags: [['d', code], ['expiration', String(now + ttlSeconds)]],
      content,
    });
    await Promise.any(this.pool.publish(this.relays, ev));
  }

  /**
   * Resolve an invite code → the inviter. Queries relays by d-tag, then
   * verifies each candidate's hash commitment (author + nonce must produce the
   * code) so a republished/hijacked code is discarded. Newest valid event wins.
   */
  resolveChatInvite(code: string, timeoutMs = 4000): Promise<{ pubkey: string; name?: string } | null> {
    return new Promise((resolve) => {
      // Newest event per AUTHOR — a rotation tombstone (empty content) must
      // supersede that author's older valid invite even when a relay serves
      // both versions of the addressable event.
      const latest = new Map<string, Event>();
      const finish = () => {
        clearTimeout(timer);
        try { sub.close(); } catch { /* already closed */ }
        let best: { pubkey: string; name?: string; createdAt: number } | null = null;
        const now = Math.floor(Date.now() / 1000);
        for (const ev of latest.values()) {
          if (!ev.content) continue; // tombstoned (rotated) invite
          const exp = Number(ev.tags.find((t) => t[0] === 'expiration')?.[1]);
          if (Number.isFinite(exp) && exp <= now) continue;
          try {
            const body = JSON.parse(ev.content) as { nonce?: string; name?: string };
            if (!body?.nonce || !verifyInviteCode(code, ev.pubkey, body.nonce)) continue; // forgery or junk
            if (!best || ev.created_at > best.createdAt) best = { pubkey: ev.pubkey, name: body.name, createdAt: ev.created_at };
          } catch { /* junk content */ }
        }
        resolve(best ? { pubkey: best.pubkey, name: best.name } : null);
      };
      const timer = setTimeout(finish, timeoutMs);
      const sub = this.pool.subscribeMany(
        this.relays,
        { kinds: [KIND_CHAT_INVITE], '#d': [code] },
        {
          onevent: (ev: Event) => {
            const cur = latest.get(ev.pubkey);
            if (cur && cur.created_at > ev.created_at) return;
            // Same-second rotate: keep the tombstone over the old invite.
            if (cur && cur.created_at === ev.created_at && !cur.content) return;
            latest.set(ev.pubkey, ev);
          },
          oneose: finish,
        },
      );
    });
  }

  /**
   * Encrypt, sign and send a negotiation DM. Never rejects on relay failure:
   * the signed event lands in the persisted outbox and is retried on
   * reconnect, so an optimistically-committed local state can't silently
   * diverge from the counterparty. Encryption/signing errors still throw.
   */
  private async sendDM(to: string, plaintext: string): Promise<string> {
    const ciphertext = await this.signer.nip04Encrypt(to, plaintext);
    const ev = await this.signer.signEvent({
      kind: 4,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', to]],
      content: ciphertext,
    });
    await this.publishDM(ev);
    return ev.id;
  }
}
