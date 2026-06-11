/**
 * Thin Nostr client for the app: subscribe to a market, post intents,
 * track negotiations. Mirrors packages/agent/src/transport.ts but with
 * React-state-friendly callbacks (React Native has WebSocket built in).
 */
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools/pure';
import * as nip04 from 'nostr-tools/nip04';
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
  openNegotiation,
  type BuildIntentInput,
  type Intent,
  type Negotiation,
} from '@freeport/protocol';

export class MobileClient {
  readonly pool = new SimplePool();
  readonly pubkey: string;
  readonly negotiations = new Map<string, Negotiation>();
  private published = new Map<string, Intent>();
  onIntent?: (intent: Intent) => void;
  onNegotiationUpdate?: (nego: Negotiation) => void;

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
          if (intent && intent.pubkey !== this.pubkey) this.onIntent?.(intent);
        },
      },
    );
    return () => sub.close();
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

  async postIntent(input: BuildIntentInput): Promise<Intent> {
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
