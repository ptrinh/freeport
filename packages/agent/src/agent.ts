import {
  applyInbound,
  applyOutbound,
  intentExpired,
  isTerminal,
  makeAccept,
  makeCancel,
  makeCounter,
  matchIntent,
  openNegotiation,
  type Intent,
  type MatchRule,
  type Negotiation,
  type NegotiationMessage,
} from '@freeport/protocol';
import type { AgentConfig } from './config.js';
import type { Transport } from './transport.js';

export interface AgentEvents {
  onLog: (line: string) => void;
  /**
   * Called when a deal needs the human's yes/no. Resolve true to accept.
   * The agent negotiates terms autonomously; only the final accept is gated.
   */
  confirmDeal: (nego: Negotiation) => Promise<boolean>;
  onDeal: (nego: Negotiation) => void;
}

/**
 * The personal agent: watches markets, matches intents against the owner's
 * rules, runs negotiations, and surfaces final accepts to the human.
 */
export class FreeportAgent {
  private negotiations = new Map<string, Negotiation>();
  private seenIntents = new Set<string>();
  private subs: { close: () => void }[] = [];
  /** Intents we ourselves published (d-tags) so we don't self-match. */
  private ownIntents = new Set<string>();

  constructor(
    private transport: Transport,
    private config: AgentConfig,
    private events: AgentEvents,
  ) {}

  trackOwnIntent(d: string): void {
    this.ownIntents.add(d);
  }

  start(): void {
    this.subs.push(
      this.transport.subscribeIntents(this.config.markets, (intent) => {
        void this.handleIntent(intent);
      }),
    );
    this.subs.push(
      this.transport.subscribeNegotiations((msg, from, eventId) => {
        void this.handleNegotiationMessage(msg, from, eventId);
      }),
    );
    this.events.onLog(
      `agent "${this.config.name}" watching markets [${this.config.markets.join(', ')}] on ${this.transport.relays.length} relays`,
    );
  }

  stop(): void {
    for (const s of this.subs) s.close();
    this.subs = [];
  }

  list(): Negotiation[] {
    return [...this.negotiations.values()];
  }

  private async handleIntent(intent: Intent): Promise<void> {
    if (intent.pubkey === this.transport.pubkey) return; // ours
    if (this.ownIntents.has(intent.d)) return;
    if (this.seenIntents.has(intent.id)) return; // same event from another relay
    this.seenIntents.add(intent.id);
    if (intentExpired(intent)) return;

    for (const rule of this.config.rules) {
      const res = matchIntent(intent, rule);
      if (!res.matched) continue;
      this.events.onLog(
        `match: "${intent.content.title}" from ${intent.pubkey.slice(0, 8)}… (${res.acceptAsIs ? 'acceptable as-is' : 'will counter'})`,
      );
      let nego = openNegotiation(intent, this.transport.pubkey, true);
      if (this.negotiations.has(nego.id)) return; // already negotiating this intent
      this.negotiations.set(nego.id, nego);

      if (res.acceptAsIs) {
        // Terms on the table are the intent's own ask.
        nego = { ...nego, terms: { window: intent.content.window, note: 'as posted' }, termsBy: 'them' };
        this.negotiations.set(nego.id, nego);
        await this.tryAccept(nego, rule);
      } else if (res.counterTerms) {
        const counter = makeCounter(nego, res.counterTerms, this.contactFor(rule));
        nego = applyOutbound(nego, counter);
        this.negotiations.set(nego.id, nego);
        await this.transport.sendNegotiation(intent.pubkey, counter);
        this.events.onLog(`sent counter → ${intent.pubkey.slice(0, 8)}…: ${JSON.stringify(res.counterTerms)}`);
      }
      return; // one rule match per intent is enough
    }
  }

  private async handleNegotiationMessage(msg: NegotiationMessage, from: string, eventId?: string): Promise<void> {
    let nego = this.negotiations.get(msg.nego);

    // First inbound message about one of OUR intents opens the negotiation.
    if (!nego) {
      const intent = this.publishedIntentById(msg.intent_id);
      if (!intent) return; // not about anything of ours
      nego = openNegotiation(intent, this.transport.pubkey, false, from);
      if (nego.id !== msg.nego) return; // sender's thread id doesn't match — drop
      this.negotiations.set(nego.id, nego);
    }
    if (isTerminal(nego)) return;

    const updated = applyInbound(nego, msg, from, eventId);
    if (!updated) return;
    this.negotiations.set(updated.id, updated);
    this.events.onLog(`recv ${msg.type} from ${from.slice(0, 8)}… (state: ${updated.state})`);

    if (msg.type === 'negotiate.counter') {
      await this.evaluateCounter(updated);
    } else if (msg.type === 'negotiate.accept') {
      if (updated.state === 'confirmed') {
        this.events.onDeal(updated);
      } else if (updated.state === 'accepted_by_them') {
        await this.tryAccept(updated, this.ruleFor(updated));
      }
    }
  }

  /** Counterparty proposed new terms — decide: accept, re-counter, or cancel. */
  private async evaluateCounter(nego: Negotiation): Promise<void> {
    const rule = this.ruleFor(nego);
    const terms = nego.terms;
    if (!terms?.window) {
      // Nothing schedulable to dispute — hand to the human.
      await this.tryAccept(nego, rule);
      return;
    }
    let res: ReturnType<typeof matchIntent>;
    if (nego.weInitiated && rule) {
      // Their intent, our rule: re-run the matcher with the counter's window
      // standing in for the ask.
      const hypothetical: Intent = {
        ...nego.intent,
        content: { ...nego.intent.content, window: terms.window },
      };
      res = matchIntent(hypothetical, rule);
    } else {
      // Counter against OUR intent: acceptable if the proposed window sits
      // within our original ask stretched by our stated flexibility.
      const ask = nego.intent.content.window;
      const flexSec = (nego.intent.content.flex_minutes ?? 0) * 60;
      const ok =
        !ask ||
        (terms.window.start >= ask.start - flexSec && terms.window.end <= ask.end + flexSec);
      res = ok
        ? { matched: true, acceptAsIs: true }
        : { matched: false, reason: 'counter outside our flexibility' };
    }
    if (res.matched && res.acceptAsIs) {
      await this.tryAccept(nego, rule);
    } else if (res.matched && res.counterTerms) {
      try {
        const counter = makeCounter(nego, res.counterTerms, this.contactFor(rule));
        const updated = applyOutbound(nego, counter);
        this.negotiations.set(updated.id, updated);
        await this.transport.sendNegotiation(updated.peer, counter);
        this.events.onLog(`re-countered: ${JSON.stringify(res.counterTerms)}`);
      } catch (e) {
        await this.cancel(nego, `round limit: ${(e as Error).message}`);
      }
    } else {
      await this.cancel(nego, res.reason ?? 'terms not workable');
    }
  }

  /** Our contact for a negotiation: the matched rule's, else the first rule's. */
  private contactFor(rule?: MatchRule): string {
    return rule?.contact ?? this.config.rules[0]?.contact ?? '';
  }

  /** Gate the final accept on the human unless auto_accept is on. */
  private async tryAccept(nego: Negotiation, rule?: MatchRule): Promise<void> {
    const auto = this.config.auto_accept || rule?.auto_accept;
    const ok = auto ? true : await this.events.confirmDeal(nego);
    const current = this.negotiations.get(nego.id);
    if (!current || isTerminal(current)) return; // changed while human was deciding
    if (!ok) {
      await this.cancel(current, 'declined by owner');
      return;
    }
    // The accept is built from CURRENT terms, but the human confirmed the
    // SNAPSHOT they were shown. If a peer counter landed mid-prompt, sealing
    // current terms would commit the owner to a price/time they never saw —
    // re-prompt on the new terms instead.
    if (!auto && JSON.stringify(current.terms) !== JSON.stringify(nego.terms)) {
      this.events.onLog('terms changed while awaiting confirmation — asking again');
      return this.tryAccept(current, rule);
    }
    const accept = makeAccept(current, this.contactFor(rule));
    const updated = applyOutbound(current, accept);
    this.negotiations.set(updated.id, updated);
    await this.transport.sendNegotiation(updated.peer || nego.intent.pubkey, accept);
    this.events.onLog(`sent accept (state: ${updated.state})`);
    if (updated.state === 'confirmed') this.events.onDeal(updated);
  }

  private async cancel(nego: Negotiation, reason: string): Promise<void> {
    const msg = makeCancel(nego, reason);
    const updated = applyOutbound(nego, msg);
    this.negotiations.set(updated.id, updated);
    if (updated.peer) await this.transport.sendNegotiation(updated.peer, msg);
    this.events.onLog(`cancelled: ${reason}`);
  }

  private ruleFor(nego: Negotiation): MatchRule | undefined {
    return this.config.rules.find(
      (r) => r.market === nego.intent.content.market && r.schema === nego.intent.content.schema,
    );
  }

  // --- published-intent registry (for negotiations others open with us) ---
  private published = new Map<string, Intent>();

  registerPublishedIntent(intent: Intent): void {
    this.published.set(intent.id, intent);
    this.ownIntents.add(intent.d);
  }

  private publishedIntentById(id: string): Intent | undefined {
    return this.published.get(id);
  }
}
