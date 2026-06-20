/**
 * One-shot relay query: collect events until EOSE (or timeout), then resolve.
 * Reuses the caller's pool so we don't open extra sockets per query.
 */
import type { SimplePool } from 'nostr-tools/pool';
import type { Event } from 'nostr-tools/pure';

export function query(
  pool: SimplePool,
  relays: string[],
  filter: Record<string, unknown>,
  timeoutMs = 4000,
): Promise<Event[]> {
  return new Promise((resolve) => {
    const events: Event[] = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sub.close();
      resolve(events);
    };
    const sub = pool.subscribeMany(relays, filter as any, {
      onevent: (ev: Event) => events.push(ev),
      oneose: finish,
    });
    const timer = setTimeout(finish, timeoutMs);
  });
}

export function tagVal(ev: Event, name: string): string | undefined {
  return ev.tags.find((t) => t[0] === name)?.[1];
}
