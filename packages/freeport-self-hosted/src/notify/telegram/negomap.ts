/**
 * Short-id ↔ negotiation-id mapping for inline-button callbacks. Telegram
 * callback_data is capped at 64 bytes; a negotiation id is `d:pubkey:pubkey`
 * (>128 chars), so buttons carry an 8-char `sid` that maps back here. Terminal
 * outcomes are recorded (and persisted) so a restart's backfill can't re-card
 * an offer the guest already accepted/declined.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface NegoRef {
  sid: string;
  negoId: string;
  telegramUserId: number;
  chatId: number;
  messageId?: number;                 // the offer-card message (to edit on resolution)
  outcome?: 'accepted' | 'countered' | 'declined' | 'confirmed';
  createdAt: number;
}

export class NegoMap {
  private bySidMap = new Map<string, NegoRef>();
  private byNego = new Map<string, NegoRef>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly path: string, private readonly flushDelayMs = 1500) {
    if (existsSync(path)) {
      try {
        for (const r of JSON.parse(readFileSync(path, 'utf8')) as NegoRef[]) { this.bySidMap.set(r.sid, r); this.byNego.set(r.negoId, r); }
      } catch { /* start empty */ }
    }
    const onExit = () => { if (this.flushTimer) this.flushNow(); };
    process.once('SIGTERM', onExit); process.once('SIGINT', onExit); process.once('beforeExit', onExit);
  }

  /** Existing ref for a negotiation, or a freshly minted one. */
  ensure(negoId: string, telegramUserId: number, chatId: number): NegoRef {
    const existing = this.byNego.get(negoId);
    if (existing) return existing;
    let sid = randomBytes(4).toString('hex').slice(0, 8);
    while (this.bySidMap.has(sid)) sid = randomBytes(4).toString('hex').slice(0, 8);
    const ref: NegoRef = { sid, negoId, telegramUserId, chatId, createdAt: Date.now() };
    this.bySidMap.set(sid, ref); this.byNego.set(negoId, ref); this.scheduleFlush();
    return ref;
  }

  bySid(sid: string): NegoRef | undefined { return this.bySidMap.get(sid); }
  byNegoId(negoId: string): NegoRef | undefined { return this.byNego.get(negoId); }

  setMessageId(sid: string, messageId: number): void {
    const r = this.bySidMap.get(sid); if (r) { r.messageId = messageId; this.scheduleFlush(); }
  }
  setOutcome(negoId: string, outcome: NegoRef['outcome']): void {
    const r = this.byNego.get(negoId); if (r) { r.outcome = outcome; this.scheduleFlush(); }
  }

  /** Drop refs older than maxAgeMs (call periodically). */
  gc(maxAgeMs: number): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [sid, r] of this.bySidMap) if (r.createdAt < cutoff) { this.bySidMap.delete(sid); this.byNego.delete(r.negoId); }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flushNow(), this.flushDelayMs);
    this.flushTimer.unref?.();
  }
  private flushNow(): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.bySidMap.values()], null, 2));
    renameSync(tmp, this.path);
  }
}
