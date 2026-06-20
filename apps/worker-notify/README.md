# Freeport notifications (Web Push, content-blind)

Two pieces:

1. **`src/index.ts`** — a Cloudflare Worker (edge HTTP API). Stores push
   subscriptions per Nostr pubkey in KV. Never sees message contents, never
   sends pushes. This is the "notification service URL" users paste in Settings.
2. **`watcher.mjs`** — a Node process on an always-on box (your LXC). Pulls the
   subscription list from the Worker, holds persistent relay connections, and on
   a `kind:4` DM addressed (`#p`) to a registered pubkey sends a generic
   "New message" push via VAPID. Content-blind (DMs stay encrypted).

```
App ──register(pubkey, subscription)──▶ Worker (KV)
                                          ▲ GET /subscriptions (admin token)
Relays ──kind:4 #p=pubkey──▶ watcher.mjs ─┘──web-push──▶ APNs/FCM ──▶ device
```

## VAPID keys (generated for this project)
- **Public** (already embedded in the app at `apps/mobile/src/push.web.ts`):
  `BJqqo3LCUitykwruoqzSqdbOiZLJ4N9B2-nCptgXs_jdRX4dXMM6Rddg3wTLiR0Fym535ES-TI8Bo1TavVF0Ang`
- **Private** (SECRET — only the watcher needs it, never commit/ship it):
  `Lrwk4LiMdZt6rIk7ZvcyhY4tZd7muNFqoRlwvwm8l-4`

If you rotate these, update the public key in `push.web.ts` and redeploy the web app.

## Deploy the Worker
```bash
cd apps/worker-notify
npx wrangler kv namespace create SUBS          # paste the id into wrangler.toml
npx wrangler secret put ADMIN_TOKEN            # any long random string
npx wrangler deploy                            # → https://freeport-notify.<sub>.workers.dev
```

## Run the watcher (on the LXC)
```bash
cd apps/worker-notify
npm i nostr-tools web-push ws
NOTIFY_API=https://freeport-notify.<sub>.workers.dev \
ADMIN_TOKEN=<same token as the secret> \
VAPID_SUBJECT=mailto:you@trinh.uk \
VAPID_PUBLIC=BJqqo3LCUitykwruoqzSqdbOiZLJ4N9B2-nCptgXs_jdRX4dXMM6Rddg3wTLiR0Fym535ES-TI8Bo1TavVF0Ang \
VAPID_PRIVATE=Lrwk4LiMdZt6rIk7ZvcyhY4tZd7muNFqoRlwvwm8l-4 \
node watcher.mjs
```
Run it under a process manager (pm2/systemd/Docker) so it stays up.

## Use it in the app
1. Open the web app, **Add to Home Screen** (required on iOS 16.4+).
2. Settings → **Notifications** → paste the Worker URL → **Enable notifications**.
3. Send yourself a DM from another account → you get a "New message" push.

## Notes
- The watcher is the only always-on cost. The Worker is free-tier generous.
- Privacy: the Worker stores `pubkey → subscription`; the watcher learns only
  *that* a DM arrived for a pubkey, not its contents. Anyone can run their own
  Worker+watcher and point the app at it (bring-your-own endpoint).
- An alternative all-Cloudflare design (Durable Object holding relay sockets +
  WebCrypto web-push) is possible but fiddlier and harder to keep reliable; the
  Node watcher is the pragmatic, battle-tested path.
