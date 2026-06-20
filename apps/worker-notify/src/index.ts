/**
 * Freeport notification API — Cloudflare Worker (edge).
 *
 * Stores push subscriptions keyed by Nostr pubkey in KV. It is content-blind:
 * it never sees message contents and never sends pushes itself. The actual
 * "you have a new message" push is sent by the relay-watcher (see ../watcher.mjs),
 * which pulls the subscription list from GET /subscriptions (admin-token gated)
 * and pushes via VAPID web-push.
 *
 * Routes:
 *   POST /register     { pubkey, subscription }   (from the app — CORS-open)
 *   POST /unregister   { pubkey, endpoint }       (from the app — CORS-open)
 *   GET  /subscriptions                            (watcher only — Bearer ADMIN_TOKEN)
 *   GET  /health
 */
export interface Env {
  SUBS: KVNamespace;
  ADMIN_TOKEN: string;
  // Optional: lock /register CORS to your app origin (else "*").
  ALLOW_ORIGIN?: string;
}

type PushSub = { endpoint: string; keys?: { p256dh?: string; auth?: string } };

const KEY = (pubkey: string) => `sub:${pubkey}`;

function cors(env: Env): Record<string, string> {
  return {
    'access-control-allow-origin': env.ALLOW_ORIGIN || '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}
const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...extra } });

function validPubkey(pk: unknown): pk is string {
  return typeof pk === 'string' && /^[0-9a-f]{64}$/.test(pk);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(env) });

    if (url.pathname === '/health') return json({ ok: true });

    if (url.pathname === '/register' && req.method === 'POST') {
      const body = await req.json().catch(() => null) as { pubkey?: string; subscription?: PushSub } | null;
      if (!body || !validPubkey(body.pubkey) || !body.subscription?.endpoint) return json({ error: 'bad request' }, 400, cors(env));
      const cur = (await env.SUBS.get(KEY(body.pubkey), 'json')) as PushSub[] | null;
      const list = (cur ?? []).filter((s) => s.endpoint !== body.subscription!.endpoint);
      list.push(body.subscription);
      await env.SUBS.put(KEY(body.pubkey), JSON.stringify(list));
      return json({ ok: true }, 200, cors(env));
    }

    if (url.pathname === '/unregister' && req.method === 'POST') {
      const body = await req.json().catch(() => null) as { pubkey?: string; endpoint?: string } | null;
      if (!body || !validPubkey(body.pubkey) || !body.endpoint) return json({ error: 'bad request' }, 400, cors(env));
      const cur = (await env.SUBS.get(KEY(body.pubkey), 'json')) as PushSub[] | null;
      const list = (cur ?? []).filter((s) => s.endpoint !== body.endpoint);
      if (list.length) await env.SUBS.put(KEY(body.pubkey), JSON.stringify(list));
      else await env.SUBS.delete(KEY(body.pubkey));
      return json({ ok: true }, 200, cors(env));
    }

    if (url.pathname === '/subscriptions' && req.method === 'GET') {
      if (req.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: 'unauthorized' }, 401);
      const out: Record<string, PushSub[]> = {};
      let cursor: string | undefined;
      do {
        const page = await env.SUBS.list({ prefix: 'sub:', cursor });
        for (const k of page.keys) {
          const pk = k.name.slice(4);
          const subs = (await env.SUBS.get(k.name, 'json')) as PushSub[] | null;
          if (subs?.length) out[pk] = subs;
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return json({ subscriptions: out });
    }

    return json({ error: 'not found' }, 404);
  },
};
