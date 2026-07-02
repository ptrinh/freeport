import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools/pure';
import * as nip04 from 'nostr-tools/nip04';
import {
  KIND_INTENT_OFFER,
  KIND_INTENT_REQUEST,
  parseIntentEvent,
  parseNegotiationMessage,
  type Intent,
  type NegotiationMessage,
} from '@freeport/protocol';

const KIND_DM = 4; // NIP-04. v1 transport; NIP-17 gift wrap is the planned upgrade.

export class Transport {
  readonly pool: SimplePool;
  readonly pubkey: string;
  private readonly ownsPool: boolean;

  constructor(
    private sk: Uint8Array,
    readonly relays: string[],
    // Share one pool across many Transports (e.g. the guest bridge runs an agent
    // per user) so N agents open relays.length sockets, not N×relays. When we
    // create the pool we own it (close it); a shared pool is left open.
    pool?: SimplePool,
  ) {
    this.pool = pool ?? new SimplePool();
    this.ownsPool = !pool;
    this.pubkey = getPublicKey(sk);
  }

  /** Publish to all relays; resolves when at least one accepts. */
  async publish(event: Event): Promise<string[]> {
    const results = await Promise.allSettled(this.pool.publish(this.relays, event));
    const ok = results
      .map((r, i) => (r.status === 'fulfilled' ? this.relays[i] : null))
      .filter((r): r is string => r !== null);
    if (ok.length === 0) {
      const firstErr = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      throw new Error(`no relay accepted the event: ${firstErr?.reason}`);
    }
    return ok;
  }

  /** Subscribe to intents in the given markets. */
  subscribeIntents(
    markets: string[],
    onIntent: (intent: Intent, ev: Event) => void,
    sinceSec?: number,
  ): { close: () => void } {
    const sub = this.pool.subscribeMany(
      this.relays,
      {
        kinds: [KIND_INTENT_OFFER, KIND_INTENT_REQUEST],
        '#t': markets,
        since: sinceSec ?? Math.floor(Date.now() / 1000) - 24 * 3600,
      },
      {
        onevent: (ev: Event) => {
          const intent = parseIntentEvent(ev);
          if (intent) onIntent(intent, ev);
        },
      },
    );
    return { close: () => sub.close() };
  }

  /** Send a negotiation message as a NIP-04 encrypted DM. */
  async sendNegotiation(to: string, msg: NegotiationMessage): Promise<void> {
    const ciphertext = await nip04.encrypt(this.sk, to, JSON.stringify(msg));
    const event = finalizeEvent(
      {
        kind: KIND_DM,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', to]],
        content: ciphertext,
      },
      this.sk,
    );
    await this.publish(event);
  }

  /** Listen for inbound negotiation DMs addressed to us. */
  subscribeNegotiations(
    onMessage: (msg: NegotiationMessage, from: string, eventId?: string) => void,
    sinceSec?: number,
  ): { close: () => void } {
    const sub = this.pool.subscribeMany(
      this.relays,
      {
        kinds: [KIND_DM],
        '#p': [this.pubkey],
        since: sinceSec ?? Math.floor(Date.now() / 1000) - 600,
      },
      {
        onevent: async (ev: Event) => {
          try {
            const plaintext = await nip04.decrypt(this.sk, ev.pubkey, ev.content);
            const msg = parseNegotiationMessage(plaintext);
            if (msg) onMessage(msg, ev.pubkey, ev.id);
          } catch {
            // Not for us / not a Freeport envelope — ignore.
          }
        },
      },
    );
    return { close: () => sub.close() };
  }

  close(): void {
    // Only tear down the relay sockets if this Transport created the pool; a
    // shared (injected) pool outlives any single Transport.
    if (this.ownsPool) this.pool.close(this.relays);
  }
}
