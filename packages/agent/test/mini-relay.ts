/**
 * Minimal in-process Nostr relay for integration tests: EVENT/REQ/CLOSE,
 * filter matching on kinds/authors/#t/#p/since. No persistence, no NIP-40.
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { Event, Filter } from 'nostr-tools';

function matches(f: Filter, ev: Event): boolean {
  if (f.kinds && !f.kinds.includes(ev.kind)) return false;
  if (f.authors && !f.authors.includes(ev.pubkey)) return false;
  if (f.since && ev.created_at < f.since) return false;
  if (f.until && ev.created_at > f.until) return false;
  for (const [key, vals] of Object.entries(f)) {
    if (!key.startsWith('#')) continue;
    const tag = key.slice(1);
    const evVals = ev.tags.filter((t) => t[0] === tag).map((t) => t[1]);
    if (!(vals as string[]).some((v) => evVals.includes(v))) return false;
  }
  return true;
}

export function startMiniRelay(port: number): { close: () => void } {
  const events: Event[] = [];
  const subs = new Map<WebSocket, Map<string, Filter[]>>();
  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws) => {
    subs.set(ws, new Map());
    ws.on('close', () => subs.delete(ws));
    ws.on('message', (data) => {
      let msg: any[];
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      const [type] = msg;
      if (type === 'EVENT') {
        const ev = msg[1] as Event;
        events.push(ev);
        ws.send(JSON.stringify(['OK', ev.id, true, '']));
        for (const [client, clientSubs] of subs) {
          for (const [subId, filters] of clientSubs) {
            if (filters.some((f) => matches(f, ev))) {
              client.send(JSON.stringify(['EVENT', subId, ev]));
            }
          }
        }
      } else if (type === 'REQ') {
        const subId = msg[1] as string;
        const filters = msg.slice(2) as Filter[];
        subs.get(ws)!.set(subId, filters);
        for (const ev of events) {
          if (filters.some((f) => matches(f, ev))) {
            ws.send(JSON.stringify(['EVENT', subId, ev]));
          }
        }
        ws.send(JSON.stringify(['EOSE', subId]));
      } else if (type === 'CLOSE') {
        subs.get(ws)?.delete(msg[1]);
      }
    });
  });

  return { close: () => wss.close() };
}
