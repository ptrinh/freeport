/**
 * Minimal NIP-01 Nostr relay, embedded so a self-hosted Freeport node (desktop
 * "host" mode / headless `--serve --notify`) can run a whole market on a LAN
 * with no external relays. In-memory store (events are ephemeral across a
 * restart — fine for a LAN/community node; NIP-40 expiry is honored so it
 * self-prunes). Transport-agnostic RelayCore is unit-tested; startRelay() wraps
 * it in a `ws` server. Off unless ENABLE_RELAY=1, so the Node/docker build is
 * unaffected.
 */
import { verifyEvent } from 'nostr-tools/pure';
import { matchFilters, type Event, type Filter } from 'nostr-tools';

type Send = (msg: unknown[]) => void;

const MAX_EVENTS = 50_000;
const MAX_SUBS_PER_CONN = 50;
const MAX_FILTERS_PER_SUB = 20;

function tagValue(ev: Event, name: string): string | undefined {
  return ev.tags.find((t) => t[0] === name)?.[1];
}
function expirationOf(ev: Event): number | null {
  const v = tagValue(ev, 'expiration');
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
function isAddressable(k: number): boolean { return k >= 30000 && k < 40000; }
function isReplaceable(k: number): boolean { return k === 0 || k === 3 || (k >= 10000 && k < 20000); }
/** Key under which only the latest event is kept (replaceable/addressable). */
function replaceKey(ev: Event): string | null {
  if (isAddressable(ev.kind)) return `${ev.kind}:${ev.pubkey}:${tagValue(ev, 'd') ?? ''}`;
  if (isReplaceable(ev.kind)) return `${ev.kind}:${ev.pubkey}`;
  return null;
}

export class RelayCore {
  private events = new Map<string, Event>();     // id → event
  private repl = new Map<string, string>();       // replaceKey → current id
  private sends = new Map<string, Send>();        // connId → send
  private subs = new Map<string, Map<string, Filter[]>>(); // connId → subId → filters

  constructor(
    private readonly max = MAX_EVENTS,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  connect(connId: string, send: Send): void {
    this.sends.set(connId, send);
    this.subs.set(connId, new Map());
  }
  disconnect(connId: string): void {
    this.sends.delete(connId);
    this.subs.delete(connId);
  }

  handle(connId: string, raw: string): void {
    const send = this.sends.get(connId);
    if (!send) return;
    let msg: unknown;
    try { msg = JSON.parse(raw); } catch { send(['NOTICE', 'error: invalid JSON']); return; }
    if (!Array.isArray(msg) || msg.length === 0) { send(['NOTICE', 'error: invalid message']); return; }
    switch (msg[0]) {
      case 'EVENT': return this.onEvent(msg[1] as Event, send);
      case 'REQ': return this.onReq(connId, String(msg[1]), msg.slice(2) as Filter[], send);
      case 'CLOSE': { this.subs.get(connId)?.delete(String(msg[1])); return; }
      default: send(['NOTICE', 'error: unknown command']);
    }
  }

  private onEvent(ev: Event, send: Send): void {
    if (!ev || typeof ev.id !== 'string') { send(['NOTICE', 'error: malformed event']); return; }
    let ok = false;
    try { ok = verifyEvent(ev); } catch { ok = false; }
    if (!ok) { send(['OK', ev.id ?? '', false, 'invalid: bad signature']); return; }

    const exp = expirationOf(ev);
    if (exp != null && exp <= this.now()) { send(['OK', ev.id, false, 'invalid: event expired']); return; }
    if (this.events.has(ev.id)) { send(['OK', ev.id, true, 'duplicate:']); return; }

    const rk = replaceKey(ev);
    if (rk) {
      const currentId = this.repl.get(rk);
      if (currentId) {
        const cur = this.events.get(currentId);
        // Keep the newer (ties → keep existing, per NIP-01).
        if (cur && cur.created_at >= ev.created_at) { send(['OK', ev.id, true, '']); return; }
        if (currentId) this.events.delete(currentId);
      }
      this.repl.set(rk, ev.id);
    }

    this.events.set(ev.id, ev);
    this.evictIfNeeded();
    send(['OK', ev.id, true, '']);
    this.broadcast(ev);
  }

  private onReq(connId: string, subId: string, filters: Filter[], send: Send): void {
    const conn = this.subs.get(connId);
    if (!conn) return;
    if (!Array.isArray(filters) || filters.length === 0 || filters.length > MAX_FILTERS_PER_SUB) {
      send(['CLOSED', subId, 'error: invalid filters']); return;
    }
    if (!conn.has(subId) && conn.size >= MAX_SUBS_PER_CONN) {
      send(['CLOSED', subId, 'error: too many subscriptions']); return;
    }
    conn.set(subId, filters);

    const now = this.now();
    const limit = Math.min(...filters.map((f) => (typeof f.limit === 'number' ? f.limit : Infinity)));
    const hits = [...this.events.values()]
      .filter((ev) => { const e = expirationOf(ev); return !(e != null && e <= now); })
      .filter((ev) => matchFilters(filters, ev))
      .sort((a, b) => b.created_at - a.created_at);
    const capped = Number.isFinite(limit) ? hits.slice(0, limit) : hits;
    for (const ev of capped) send(['EVENT', subId, ev]);
    send(['EOSE', subId]);
  }

  /** Deliver a freshly stored event to every live subscription that matches. */
  private broadcast(ev: Event): void {
    for (const [connId, conn] of this.subs) {
      const send = this.sends.get(connId);
      if (!send) continue;
      for (const [subId, filters] of conn) {
        if (matchFilters(filters, ev)) send(['EVENT', subId, ev]);
      }
    }
  }

  private evictIfNeeded(): void {
    if (this.events.size <= this.max) return;
    const oldest = [...this.events.values()].sort((a, b) => a.created_at - b.created_at);
    for (const ev of oldest) {
      if (this.events.size <= this.max) break;
      this.events.delete(ev.id);
      const rk = replaceKey(ev);
      if (rk && this.repl.get(rk) === ev.id) this.repl.delete(rk);
    }
  }

  /** Drop expired events (call periodically). */
  prune(): void {
    const now = this.now();
    for (const [id, ev] of this.events) {
      const e = expirationOf(ev);
      if (e != null && e <= now) {
        this.events.delete(id);
        const rk = replaceKey(ev);
        if (rk && this.repl.get(rk) === id) this.repl.delete(rk);
      }
    }
  }

  /** Test/introspection helper. */
  size(): number { return this.events.size; }
}

/** Start a NIP-01 relay over WebSocket. Returns a stop function. */
export async function startRelay(opts: { port: number; host?: string }): Promise<() => void> {
  const { WebSocketServer } = await import('ws');
  const core = new RelayCore();
  const wss = new WebSocketServer({ port: opts.port, host: opts.host ?? '0.0.0.0' });
  let counter = 0;
  wss.on('connection', (ws) => {
    const id = String(++counter);
    core.connect(id, (msg) => { try { ws.send(JSON.stringify(msg)); } catch { /* closed */ } });
    ws.on('message', (data: unknown) => core.handle(id, String(data)));
    ws.on('close', () => core.disconnect(id));
    ws.on('error', () => {});
  });
  const sweep = setInterval(() => core.prune(), 60_000);
  console.error(`[freeport-nostr] relay (NIP-01) on ws://${opts.host ?? '0.0.0.0'}:${opts.port}`);
  return () => { clearInterval(sweep); wss.close(); };
}
