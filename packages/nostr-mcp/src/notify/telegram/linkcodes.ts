/**
 * Single-use, short-lived link codes binding a Nostr pubkey to a Telegram chat.
 * Flow: the app POSTs /telegram/link {pubkey} → gets a code + a t.me deep link →
 * the user opens it and hits `/start <code>` → the bot consumes the code and
 * links that chat to the pubkey. In-memory only: a restart invalidates pending
 * codes (the app just re-requests), which is fine and avoids persisting a
 * pubkey↔chat pre-binding to disk.
 */
import { randomBytes } from 'node:crypto';

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PENDING = 500;       // backstop against unbounded growth

export class LinkCodes {
  private codes = new Map<string, { pubkey: string; expiresAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Mint a code for a pubkey. Evicts the oldest if over capacity. */
  create(pubkey: string): string {
    this.gc();
    if (this.codes.size >= MAX_PENDING) {
      const oldest = this.codes.keys().next().value;
      if (oldest) this.codes.delete(oldest);
    }
    const code = randomBytes(9).toString('base64url'); // 12 url-safe chars
    this.codes.set(code, { pubkey, expiresAt: this.now() + TTL_MS });
    return code;
  }

  /** Consume a code (single-use). Returns the pubkey, or null if unknown/expired. */
  consume(code: string): string | null {
    const entry = this.codes.get(code);
    if (!entry) return null;
    this.codes.delete(code);
    if (entry.expiresAt < this.now()) return null;
    return entry.pubkey;
  }

  private gc(): void {
    const t = this.now();
    for (const [code, e] of this.codes) if (e.expiresAt < t) this.codes.delete(code);
  }
}
