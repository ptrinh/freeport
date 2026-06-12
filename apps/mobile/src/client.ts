/**
 * Thin Nostr client for the app: subscribe to a market, post intents,
 * track negotiations. Mirrors packages/agent/src/transport.ts but with
 * React-state-friendly callbacks (React Native has WebSocket built in).
 */
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools/pure';
import * as nip04 from 'nostr-tools/nip04';
import { publishProfile, type UserProfile } from './profile';
import {
  DEFAULT_RELAYS,
  KIND_INTENT_OFFER,
  KIND_INTENT_REQUEST,
  buildIntentEvent,
  parseIntentEvent,
  parseNegotiationMessage,
  applyInbound,
  applyOutbound,
  makeAccept,
  makeCancel,
  makeCounter,
  openNegotiation,
  type BuildIntentInput,
  type Intent,
  type Negotiation,
  type ProposedTerms,
} from '@freeport/protocol';

export class MobileClient {
  readonly pool = new SimplePool();
  readonly pubkey: string;
  readonly negotiations = new Map<string, Negotiation>();
  private published = new Map<string, Intent>();
  /** Cache of fetched kind:0 profiles keyed by pubkey. */
  readonly profiles = new Map<string, { name?: string; picture?: string; about?: string }>();
  onIntent?: (intent: Intent) => void;
  onNegotiationUpdate?: (nego: Negotiation) => void;
  onProfileFetched?: (pubkey: string) => void;

  constructor(
    private sk: Uint8Array,
    readonly relays: string[] = DEFAULT_RELAYS,
  ) {
    this.pubkey = getPublicKey(sk);
  }

  watchMarket(market: string): () => void {
    const sub = this.pool.subscribeMany(
      this.relays,
      {
        kinds: [KIND_INTENT_OFFER, KIND_INTENT_REQUEST],
        '#t': [market],
        since: Math.floor(Date.now() / 1000) - 24 * 3600,
      },
      {
        onevent: (ev: Event) => {
          const intent = parseIntentEvent(ev);
          if (!intent || intent.pubkey === this.pubkey) return;
          this.onIntent?.(intent);
          this.fetchProfile(intent.pubkey);
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
            this.profiles.set(pubkey, { name: meta.name, picture: meta.picture, about: meta.about });
            this.onProfileFetched?.(pubkey);
          } catch {}
        },
        oneose: () => sub.close(),
      },
    );
  }

  watchDMs(): () => void {
    const sub = this.pool.subscribeMany(
      this.relays,
      { kinds: [4], '#p': [this.pubkey], since: Math.floor(Date.now() / 1000) - 600 },
      {
        onevent: async (ev: Event) => {
          try {
            const plain = await nip04.decrypt(this.sk, ev.pubkey, ev.content);
            const msg = parseNegotiationMessage(plain);
            if (!msg) return;
            let nego = this.negotiations.get(msg.nego);
            if (!nego) {
              const intent = this.published.get(msg.intent_id);
              if (!intent) return;
              nego = openNegotiation(intent, this.pubkey, false, ev.pubkey);
              if (nego.id !== msg.nego) return;
            }
            const updated = applyInbound(nego, msg, ev.pubkey);
            if (!updated) return;
            this.negotiations.set(updated.id, updated);
            this.onNegotiationUpdate?.(updated);
          } catch {
            /* not a Freeport DM */
          }
        },
      },
    );
    return () => sub.close();
  }

  /**
   * Publish the user's kind:0 profile (NIP-01). Call whenever the profile is
   * saved so counterparties can fetch the author's name/picture/about.
   */
  async publishProfile(profile: UserProfile): Promise<void> {
    await publishProfile(this.sk, profile, this.relays);
  }

  /**
   * Post an intent. If a profile is provided it is (re-)published first so
   * counterparties see up-to-date metadata alongside the new intent.
   */
  async postIntent(input: BuildIntentInput, profile?: UserProfile): Promise<Intent> {
    if (profile && (profile.name || profile.picture || profile.about)) {
      // Fire-and-forget: profile publish is best-effort, don't block posting
      publishProfile(this.sk, profile, this.relays).catch(() => {});
    }
    const ev = buildIntentEvent(input, this.sk);
    const intent = parseIntentEvent(ev)!;
    this.published.set(intent.id, intent);
    await Promise.any(this.pool.publish(this.relays, ev));
    return intent;
  }

  /** Human tapped "Accept" on a pending negotiation. */
  async accept(negoId: string, contact: string): Promise<void> {
    const nego = this.negotiations.get(negoId);
    if (!nego) return;
    const msg = makeAccept(nego, contact);
    const updated = applyOutbound(nego, msg);
    this.negotiations.set(updated.id, updated);
    await this.sendDM(updated.peer, JSON.stringify(msg));
    this.onNegotiationUpdate?.(updated);
  }

  /** Human edited and submitted a counter-offer. */
  async counter(negoId: string, terms: ProposedTerms): Promise<void> {
    const nego = this.negotiations.get(negoId);
    if (!nego) return;
    const msg = makeCounter(nego, terms);
    const updated = applyOutbound(nego, msg);
    this.negotiations.set(updated.id, updated);
    await this.sendDM(updated.peer, JSON.stringify(msg));
    this.onNegotiationUpdate?.(updated);
  }

  /** Human tapped "Decline". */
  async decline(negoId: string): Promise<void> {
    const nego = this.negotiations.get(negoId);
    if (!nego) return;
    const msg = makeCancel(nego, 'declined');
    const updated = applyOutbound(nego, msg);
    this.negotiations.set(updated.id, updated);
    await this.sendDM(updated.peer, JSON.stringify(msg));
    this.onNegotiationUpdate?.(updated);
  }

  private async sendDM(to: string, plaintext: string): Promise<void> {
    const ciphertext = await nip04.encrypt(this.sk, to, plaintext);
    const ev = finalizeEvent(
      {
        kind: 4,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', to]],
        content: ciphertext,
      },
      this.sk,
    );
    await Promise.any(this.pool.publish(this.relays, ev));
  }
}
