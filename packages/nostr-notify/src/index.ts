#!/usr/bin/env node
/**
 * Freeport Web Push notifier — entry point.
 *
 * Anyone can run this to become a push host for Freeport's web/PWA users
 * (including iOS Home-Screen installs, iOS 16.4+). It generates its own VAPID
 * keypair, stores push subscriptions + filters, watches Nostr relays, and
 * pushes a short content-blind notification when a matching intent appears.
 *
 * NOT for the native App Store iOS app — that needs Apple's APNs key and can't
 * be operated by arbitrary hosts.
 */
import express from 'express';
import { z } from 'zod';
import { DEFAULT_RELAYS } from '@freeport/protocol';
import { loadVapid, configureWebPush } from './vapid.js';
import { SubStore } from './store.js';
import { Watcher } from './watcher.js';

const PORT = Number(process.env.PORT ?? 8789);
const HOST = process.env.HOST ?? '127.0.0.1';
const DATA_DIR = process.env.DATA_DIR ?? './data';
const relays = process.env.FREEPORT_RELAYS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [...DEFAULT_RELAYS];

const vapid = loadVapid(`${DATA_DIR}/vapid.json`);
const publicKey = configureWebPush(vapid);
const store = new SubStore(`${DATA_DIR}/subscriptions.json`);
const watcher = new Watcher(relays, store);
watcher.refresh();

const subSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string(), auth: z.string() }),
  }),
  filters: z.object({
    kinds: z.array(z.number().int()).max(20).optional(),
    topics: z.array(z.string()).max(50).optional(),
    near: z.object({ lat: z.number(), lon: z.number(), radiusKm: z.number().positive().max(20000) }).optional(),
  }).default({}),
});

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '32kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, relays, subscriptions: store.size() }));

// Clients fetch this to create a push subscription bound to THIS host.
app.get('/vapidPublicKey', (_req, res) => res.json({ publicKey }));

app.post('/subscribe', (req, res) => {
  const parsed = subSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const rec = store.upsert(parsed.data.subscription, parsed.data.filters);
  watcher.refresh(); // pick up any new kinds
  res.json({ ok: true, id: rec.id });
});

app.post('/unsubscribe', (req, res) => {
  const id = typeof req.body?.id === 'string' ? req.body.id : '';
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  res.json({ ok: store.remove(id) });
});

app.listen(PORT, HOST, () => {
  console.error(`[notify] http://${HOST}:${PORT}  •  ${store.size()} subscriptions  •  ${relays.length} relays`);
  console.error(`[notify] VAPID public key: ${publicKey}`);
});
