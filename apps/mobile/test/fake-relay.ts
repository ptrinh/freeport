/**
 * A tiny in-process Nostr relay shared by several MobileClient instances in a
 * test, so they exchange real signed events through the client's real code
 * paths. Only the network (SimplePool) is faked — signing and NIP-04 stay real.
 *
 * Implements just the surface MobileClient uses: subscribeMany(relays, filter,
 * {onevent, oneose}) with live delivery + replay of matching stored events,
 * publish(relays, ev) → Promise[], and the connection helpers.
 */
import type { Event } from 'nostr-tools';

type Filter = Record<string, any>;
interface Sub { filters: Filter[]; onevent: (ev: Event) => void; oneose?: () => void; closed: boolean }

function matches(f: Filter, ev: Event): boolean {
  if (f.ids && !f.ids.includes(ev.id)) return false;
  if (f.kinds && !f.kinds.includes(ev.kind)) return false;
  if (f.authors && !f.authors.includes(ev.pubkey)) return false;
  if (typeof f.since === 'number' && ev.created_at < f.since) return false;
  if (typeof f.until === 'number' && ev.created_at > f.until) return false;
  for (const key of Object.keys(f)) {
    if (key[0] !== '#') continue;
    const tag = key.slice(1);
    const want: string[] = f[key];
    const have = ev.tags.filter((t) => t[0] === tag).map((t) => t[1]);
    if (!want.some((v) => have.includes(v))) return false;
  }
  return true;
}

export class FakeRelay {
  private events: Event[] = [];
  private subs = new Set<Sub>();
  /** Simulate a total outage: publishes reject (drives the client's outbox). */
  down = false;

  /** SimplePool.publish shape: returns one promise per relay. */
  publish(_relays: string[], ev: Event): Promise<string>[] {
    if (this.down) {
      const p = Promise.reject(new Error('relay down'));
      p.catch(() => {}); // pre-observe so an un-awaited slot can't be an unhandled rejection
      return [p];
    }
    this.events.push(ev);
    for (const s of this.subs) {
      if (s.closed) continue;
      if (s.filters.some((f) => matches(f, ev))) s.onevent(ev);
    }
    return [Promise.resolve('ok')];
  }

  subscribeMany(_relays: string[], filterOrFilters: Filter | Filter[], handlers: { onevent: (ev: Event) => void; oneose?: () => void }) {
    // Mirror the REAL SimplePool API: subscribeMany takes ONE filter. An
    // array once slipped into production behind an `as any` and silently
    // killed all DM delivery — the fake must be as strict as the real thing.
    if (Array.isArray(filterOrFilters)) {
      throw new Error('SimplePool.subscribeMany takes a single Filter — got an array (use one subscription per filter)');
    }
    const filters = [filterOrFilters];
    const sub: Sub = { filters, onevent: handlers.onevent, oneose: handlers.oneose, closed: false };
    this.subs.add(sub);
    for (const ev of this.events) {
      if (sub.filters.some((f) => matches(f, ev))) sub.onevent(ev);
    }
    // A real relay sends EOSE asynchronously — deferring matters because
    // callers do `const sub = subscribeMany(...)` with `oneose: () =>
    // sub.close()`; firing it synchronously hits `sub` in its TDZ.
    queueMicrotask(() => { if (!sub.closed) handlers.oneose?.(); });
    return { close: () => { sub.closed = true; this.subs.delete(sub); } };
  }

  async ensureRelay(_url: string): Promise<void> { /* always "connected" */ }
  listConnectionStatus(): Map<string, boolean> { return new Map([['ws://fake', true]]); }
  close(): void { /* no-op */ }
  destroy(): void { this.subs.clear(); this.events = []; }
}

/** Flush pending microtasks/timers a few times so async DM decrypt + fire-and-
 *  forget publishes settle before assertions. */
export async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}
