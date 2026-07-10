/**
 * Per-chat serial send scheduler. Telegram rate-limits messages to a single
 * chat/group (~20/min → we keep a conservative floor between sends), and a
 * flood-triggered 429 must be honored, not hammered. Each chat has its own
 * promise chain so one slow/rate-limited chat never blocks another.
 */
import { RetryAfterError } from './api.js';

const MIN_SPACING_MS = 3000; // ≥3s between sends to the same chat

export class SendQueue {
  private chains = new Map<number, { chain: Promise<unknown>; lastAt: number }>();

  constructor(
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Enqueue `task` for `chatId`; resolves with its result (or rejects). */
  enqueue<T>(chatId: number, task: () => Promise<T>): Promise<T> {
    // lastAt = -Infinity so a chat's FIRST send never waits (only spacing between sends).
    const entry = this.chains.get(chatId) ?? { chain: Promise.resolve(), lastAt: -Infinity };
    const run = entry.chain.then(async () => {
      const wait = entry.lastAt + MIN_SPACING_MS - this.now();
      if (wait > 0) await this.sleep(wait);
      try {
        return await task();
      } catch (e) {
        if (e instanceof RetryAfterError) {
          await this.sleep(e.retryAfterSec * 1000);
          return await task(); // one retry after the flood window
        }
        throw e;
      } finally {
        entry.lastAt = this.now();
      }
    });
    // Keep the chain alive regardless of this task's success so the next send still spaces.
    entry.chain = run.then(() => undefined, () => undefined);
    this.chains.set(chatId, entry);
    return run as Promise<T>;
  }
}
