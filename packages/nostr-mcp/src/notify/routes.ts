/**
 * Web Push notifier — mounted onto the same Express app as the MCP endpoint so
 * both share one hostname. Self-hostable + content-blind: watches relays and
 * pushes new matching intents to subscribed browsers/PWAs (incl. iOS 16.4+
 * Home-Screen installs). Native App Store iOS push is NOT here — it needs
 * Apple's APNs key, which can't be run by arbitrary hosts.
 *
 * Stateful (subscription store + a VAPID secret + a long-lived relay watcher),
 * deliberately kept separate from the read-only MCP tools.
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { loadVapid, configureWebPush } from './vapid.js';
import { SubStore } from './store.js';
import { Watcher } from './watcher.js';

const subSchema = z.object({
  // Web Push transport (browser/PWA)…
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string(), auth: z.string() }),
  }).optional(),
  // …or native transport (Expo push token, iOS/Android app). Exactly one.
  expoPushToken: z.string().optional(),
  filters: z.object({
    kinds: z.array(z.number().int()).max(20).optional(),
    topics: z.array(z.string()).max(50).optional(),
    near: z.object({ lat: z.number(), lon: z.number(), radiusKm: z.number().positive().max(20000) }).optional(),
  }).default({}),
  /** Watch this pubkey for inbound DMs (kind 4) → "New message" push. */
  pubkey: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).refine((d) => !!d.subscription !== !!d.expoPushToken, {
  message: 'Provide exactly one of subscription (web) or expoPushToken (native).',
});

export interface Notifier { store: SubStore; watcher: Watcher; publicKey: string; }

/** Wire VAPID + store + watcher and register the notify routes. */
export function mountNotify(app: Express, relays: string[], dataDir: string, limiter: RequestHandler): Notifier {
  const vapid = loadVapid(`${dataDir}/vapid.json`);
  const publicKey = configureWebPush(vapid);
  const store = new SubStore(`${dataDir}/subscriptions.json`);
  const watcher = new Watcher(relays, store);
  watcher.refresh();

  // TTL sweep: prune subscriptions not refreshed within SUB_TTL_DAYS (default
  // 365). The app re-subscribes on launch, so a stale record is a device that
  // stopped checking in (e.g. an uninstall the 404/410/DeviceNotRegistered prune
  // never caught because its filters never matched an event). Set SUB_TTL_DAYS=0
  // to disable. Daily timer, unref'd so it never holds the process open.
  const ttlDays = Math.max(0, Number(process.env.SUB_TTL_DAYS ?? 365));
  if (ttlDays > 0) {
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
    const sweep = () => {
      const n = store.sweepStale(ttlMs);
      if (n) { console.error(`[notify] TTL sweep pruned ${n} subscription(s) idle > ${ttlDays}d`); watcher.refresh(); }
    };
    const timer = setInterval(sweep, 24 * 60 * 60 * 1000);
    timer.unref?.();
    sweep(); // once on boot
  }

  // Clients fetch this to create a push subscription bound to THIS host.
  app.get('/vapidPublicKey', limiter, (_req, res) => { res.json({ publicKey }); });

  app.post('/subscribe', limiter, (req, res) => {
    const parsed = subSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const { subscription, expoPushToken, filters, pubkey } = parsed.data;
    const rec = expoPushToken
      ? store.upsertExpo(expoPushToken, filters, pubkey)
      : store.upsertWeb(subscription!, filters, pubkey);
    watcher.refresh(); // pick up any new kinds / pubkeys
    res.json({ ok: true, id: rec.id });
  });

  // Accepts { id } or { key } (push endpoint URL or Expo token) — the app knows
  // its transport key, not the server-side id.
  app.post('/unsubscribe', limiter, (req, res) => {
    const id = typeof req.body?.id === 'string' ? req.body.id : '';
    const key = typeof req.body?.key === 'string' ? req.body.key
      : typeof req.body?.endpoint === 'string' ? req.body.endpoint
      : typeof req.body?.expoPushToken === 'string' ? req.body.expoPushToken : '';
    if (!id && !key) { res.status(400).json({ error: 'id or key required' }); return; }
    const ok = id ? store.remove(id) : store.removeByKey(key);
    watcher.refresh();
    res.json({ ok });
  });

  console.error(`[notify] mounted • ${store.size()} subscriptions • VAPID public key: ${publicKey}`);
  return { store, watcher, publicKey };
}
