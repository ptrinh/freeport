# freeport-nostr-notify

A **self-hostable, content-blind Web Push notifier** for Freeport. Run it and you become a push host: it watches Nostr relays and sends a short notification to subscribed browsers/PWAs when a new intent matches their filters (kind, topic, geohash radius).

Works for **web + installed PWAs, including iOS 16.4+ Home-Screen installs** — those use the standard Web Push protocol (VAPID), so any host can send. It does **NOT** push to the native App Store iOS app: that requires Apple's APNs key and can only be run by the app owner.

## Run

```bash
npx freeport-nostr-notify
# or: docker compose up -d
```

On first start it generates a VAPID keypair (saved to `DATA_DIR/vapid.json`) and prints the **public** key. The private key is a secret and never logged.

## API

| Route | Purpose |
|-------|---------|
| `GET /vapidPublicKey` | Public key — clients use it to create a push subscription bound to this host. |
| `POST /subscribe` | Body `{ subscription, filters }`. `filters`: `{ kinds?, topics?, near?{lat,lon,radiusKm} }`. |
| `POST /unsubscribe` | Body `{ id }`. |
| `GET /health` | Status + subscription count. |

A Freeport client points its `notifyEndpoint` preference at this host's URL, fetches `/vapidPublicKey`, subscribes via the browser Push API, and POSTs the subscription + its chosen filters to `/subscribe`.

## Config (env)

- `PORT` (8789), `HOST` (127.0.0.1), `DATA_DIR` (./data)
- `FREEPORT_RELAYS` — comma-separated wss URLs (defaults to the Freeport set)
- `VAPID_SUBJECT` — `mailto:` or URL contact (required by the Web Push spec)
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — pin keys so subscriptions survive a data wipe

## Privacy

Stores only the opaque push endpoint/keys and the coarse filters the user chose — no identity, no message content. Notifications are generic ("New request near you"); the public event id is included only so the app can deep-link.
