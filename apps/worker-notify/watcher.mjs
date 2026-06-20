/**
 * Freeport relay-watcher → web-push sender. Run on an always-on box (e.g. your
 * LXC) — persistent relay WebSockets + the mature `web-push` lib live happily
 * there. It is CONTENT-BLIND: it sees only that a kind:4 DM is addressed to a
 * registered pubkey (#p tag) and pushes a generic "New message". DMs are
 * NIP-04 encrypted; this never decrypts them.
 *
 *   npm i nostr-tools web-push ws
 *   NOTIFY_API=https://freeport-notify.<sub>.workers.dev \
 *   ADMIN_TOKEN=... VAPID_PUBLIC=... VAPID_PRIVATE=... VAPID_SUBJECT=mailto:you@x \
 *   node watcher.mjs
 */
import { SimplePool } from 'nostr-tools/pool';
import webpush from 'web-push';
import WebSocket from 'ws';
globalThis.WebSocket = WebSocket;

const NOTIFY_API = process.env.NOTIFY_API;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const RELAYS = (process.env.RELAYS || 'wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net,wss://nostr.mom,wss://relay.nostr.band').split(',');
const REFRESH_MS = 60_000;        // re-pull the subscription list this often
const DEDUP_MS = 5 * 60_000;      // suppress repeat pushes per (pubkey,event)

webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);

const pool = new SimplePool();
let subsByPubkey = {};            // pubkey -> [PushSub]
let sub = null;                   // current relay subscription
let watching = [];                // pubkeys currently subscribed
const recent = new Map();         // eventId -> ts (dedup)

async function pullSubscriptions() {
  const res = await fetch(`${NOTIFY_API.replace(/\/$/, '')}/subscriptions`, {
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  if (!res.ok) throw new Error(`subscriptions ${res.status}`);
  const { subscriptions } = await res.json();
  subsByPubkey = subscriptions || {};
}

async function pushTo(pubkey, eventId) {
  const now = Date.now();
  const key = `${pubkey}:${eventId}`;
  if (recent.has(key)) return;
  recent.set(key, now);
  const payload = JSON.stringify({ title: 'Freeport', body: 'New message', url: '/', tag: 'freeport-msg' });
  for (const s of subsByPubkey[pubkey] || []) {
    try {
      await webpush.sendNotification(s, payload);
    } catch (e) {
      // 404/410 → subscription is dead; tell the API to drop it.
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        fetch(`${NOTIFY_API.replace(/\/$/, '')}/unregister`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pubkey, endpoint: s.endpoint }),
        }).catch(() => {});
      }
    }
  }
}

function resubscribe() {
  const pubkeys = Object.keys(subsByPubkey);
  if (pubkeys.join(',') === watching.join(',')) return; // unchanged
  watching = pubkeys;
  if (sub) sub.close();
  if (!pubkeys.length) { sub = null; return; }
  // Watch DMs addressed to any registered pubkey, from now on.
  sub = pool.subscribeMany(
    RELAYS,
    [{ kinds: [4], '#p': pubkeys, since: Math.floor(Date.now() / 1000) }],
    {
      onevent: (ev) => {
        const p = ev.tags.find((t) => t[0] === 'p')?.[1];
        if (p && subsByPubkey[p]) pushTo(p, ev.id);
      },
    },
  );
  console.log(`[watcher] watching ${pubkeys.length} pubkey(s)`);
}

async function tick() {
  try { await pullSubscriptions(); resubscribe(); }
  catch (e) { console.error('[watcher] refresh failed:', e.message); }
  // prune dedup map
  const cutoff = Date.now() - DEDUP_MS;
  for (const [k, ts] of recent) if (ts < cutoff) recent.delete(k);
}

await tick();
setInterval(tick, REFRESH_MS);
console.log('[watcher] running');
