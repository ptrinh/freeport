# freeport-nostr-mcp

An MCP server that lets AI agents **search Freeport's decentralized Nostr marketplace** — ride requests, driver/provider offers, service & product posts, and reputation — by **kind, tag, and geohash radius**. Read-only; never signs or publishes; never touches encrypted DMs.

## Tools

| Tool | What it does |
|------|--------------|
| `nostr_search_intents` | Offers/requests by side + topic tags + distance radius. Decoded, expiry-filtered, sorted nearest-first. |
| `nostr_search_reputation` | Karma ratings (kind 32103) + proven deal count (kind 32104 receipt pairs) for a pubkey. |
| `nostr_profile` | NIP-01 profile metadata (kind 0) for any pubkey(s), optionally with recent notes. General-purpose. |
| `nostr_get_event` | Fetch events by id. |
| `nostr_query_raw` | Arbitrary NIP-01 filter escape hatch. |

Every query tool accepts an optional `relays` array to override the relay set for that call (ws/wss only, max 10, private/loopback hosts blocked).

On connect, the server sends an **instructions** string and exposes two **resources** so an agent self-onboards: `freeport://relays` (active relay set) and `freeport://protocol` (event kinds, intent schema, discovery tags, tool usage).

## Example agent prompts

- "Find ride requests within 10 km of {lat},{lon} in Hanoi." → `nostr_search_intents { side:"request", near:{lat,lon,radiusKm:10}, topics:["vn_hanoi_ridesharing"] }`
- "Any plumbers offering service near me right now?" → `nostr_search_intents { side:"offer", near:{...}, topics:["<area>_homeservices_plumbing"] }`
- "Is this seller trustworthy before I deal with them?" → `nostr_search_reputation { pubkey }`
- "Who is npub… and what have they posted?" → `nostr_profile { pubkeys:["<hex>"], recentNotes:5 }`
- "Show me everything new in my city in the last hour." → `nostr_search_intents { topics:["<area>"], since:<unix-1h> }`

## Run

```bash
# stdio (Claude Desktop / registry self-host)
npx freeport-nostr-mcp

# hosted HTTP endpoint
PORT=8788 npm run start:http   # POST /mcp, GET /health
```

`FREEPORT_RELAYS` (comma-separated wss URLs) overrides the default relay set.

## Scalability

- **One shared `SimplePool`** — a single websocket per relay, multiplexed across all requests.
- **Short-TTL query cache + in-flight dedup** — repeated/identical agent queries collapse to one relay round-trip.
- **Stateless HTTP** — no per-session state; scale horizontally behind a load balancer (add a shared cache like Redis if you run multiple nodes).
- **Rate limiting** (hosted endpoint) — per-IP + global token buckets return `429` with `Retry-After`. Tunables: `RATE_LIMIT_PER_MIN` (default 60), `RATE_LIMIT_GLOBAL_PER_MIN` (1200), `RATE_LIMIT_BURST` (20). Behind Cloudflare it keys on `CF-Connecting-IP`. `/health` is exempt.

## Web Push notifier (same hostname)

The HTTP server also runs a self-hostable, content-blind **Web Push** notifier on the same host — so anyone running this becomes a push host for Freeport web/PWA users (incl. iOS 16.4+ Home-Screen installs). It does **not** push to the native App Store iOS app (that needs Apple's APNs key, runnable only by the app owner). Set `ENABLE_NOTIFY=0` for MCP-only.

| Route | Purpose |
|-------|---------|
| `GET /vapidPublicKey` | Public key — clients create a push subscription bound to this host. |
| `POST /subscribe` | `{ subscription, filters }`; `filters`: `{ kinds?, topics?, near?{lat,lon,radiusKm} }`. |
| `POST /unsubscribe` | `{ id }`. |

It watches relays for new intents matching each subscriber's filters and sends a short generic notification. Config: `DATA_DIR` (subscription store + VAPID keys), `VAPID_SUBJECT`, optional `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` to pin keys across redeploys. Stores only opaque push keys + coarse filters — no identity or message content.

Dead subscriptions are pruned automatically when a push fails (`404`/`410` for Web Push, `DeviceNotRegistered` for Expo). As a backstop for subs that go dead without ever being pushed to, a daily **TTL sweep** removes any not refreshed within `SUB_TTL_DAYS` (default `365`; set `0` to disable) — the app re-subscribes on launch, so this only catches devices that have stopped checking in.

### Hardware

A **Raspberry Pi Zero with ~50 Mbps WiFi is enough to run a notification node for a few thousand subscribers** — this server is barely hardware-bound. Any always-on machine with ~256-512 MB RAM and a modest CPU (a Pi, the smallest VPS, an Umbrel/home-server container) covers a personal or community deployment. To make a home node reachable without port-forwarding, expose it publicly through **Tailscale Funnel** or a **Cloudflare Tunnel** — both also terminate inbound TLS at their edge, sparing the Pi that work.

What actually scales:

- **RAM** tracks subscriber count: ~300 bytes per subscription, so ~3 MB per 10k subs (1M subs ≈ 300 MB). Rarely the limit.
- **CPU / bandwidth** track event + push *throughput*, not subscriber count. Matching is single-threaded; for high volume run multiple instances (`cluster`) and partition by region using `#t` topic tags so no single node pulls the whole network's firehose.
- **Disk** is trivial — small atomic JSON writes; any SSD/SD card is fine.

For most self-hosters the constraint is bandwidth and uptime, not the box.

## Telegram bridge (optional)

The same server can run a Telegram bot that meets communities where they already
coordinate (e.g. rideshare groups). Long-poll based — **no public webhook
needed**, so it works behind a Cloudflare/Tailscale tunnel. Set
`TELEGRAM_BOT_TOKEN` (from [@BotFather](https://t.me/BotFather)) to enable;
`ENABLE_TELEGRAM=0` force-disables. Zero extra npm dependencies.

Three layers, from least to most involved:

1. **Group feed + listen mode** *(token only — no custody)*. A group admin
   `/watch <market-or-topic>` or `/near <geohash|lat,lon> <km>` and matching
   intents post as cards (collapsed + edited per listing, struck through on
   withdrawal). `/listen on` makes the bot parse organic "Pick up: … / Drop off:
   …" posts and offer a one-tap **Broadcast to Freeport** button that deep-links
   to the web post form, prefilled.
   - For listen mode, disable the bot's privacy in BotFather (`/setprivacy` →
     your bot → **Disable**) so it can read non-command group posts, or make it
     a group admin.
2. **Personal pings** *(token only)*. The app's Settings → *Link Telegram*
   binds a chat to a pubkey (`POST /telegram/link`); the bot then sends
   content-blind "new activity" DMs (same coalescing/prune path as Web Push).
3. **Guest-agent mode** *(CUSTODIAL — opt-in)*. Set
   `TELEGRAM_GUEST_KEY_PASSPHRASE` and Telegram-native users can `/ride A -> B
   for 20`, receive offer cards with driver reputation, and Accept / Counter /
   Decline entirely in chat. The bridge holds one **NIP-49-encrypted** key per
   guest and runs a `FreeportAgent` on their behalf. `/exportkey` graduates a
   guest to the sovereign app; `/forgetme` deletes them. This makes the operator
   a key custodian for guest users — a deliberate zero-install trade-off over
   low-value, freshly-minted keys. Leave the passphrase unset to run layers 1–2
   only.

| Env | Default | Purpose |
|-----|---------|---------|
| `TELEGRAM_BOT_TOKEN` | — | Enables the bridge (feed + pings). |
| `TELEGRAM_WEB_BASE` | `https://freeport.trinh.uk` | Deep-link origin for buttons. |
| `TELEGRAM_POLL_TIMEOUT_SEC` | `50` | Long-poll timeout. |
| `TELEGRAM_GUEST_KEY_PASSPHRASE` | — | Enables guest mode; NIP-49 at-rest key encryption. **Secret.** |
| `GUEST_COUNTRY_HINT` | — | Nominatim country bias for guest geocoding (e.g. `sg`). |
| `GUEST_POSTS_PER_DAY` / `GUEST_MAX_ACTIVE_POSTS` | `10` / `3` | Per-guest quotas. |
| `GUEST_RIDE_EXPIRY_MIN` / `GUEST_OFFER_TIMEOUT_MIN` | `120` / `15` | Post lifetime / offer-decision timeout. |

Secrets belong in a gitignored `.env` (Compose `env_file`), **never** in a
committed `docker-compose.yml`. Verify after enabling:

```bash
curl -s http://127.0.0.1:8788/health | jq .telegram
# → { "enabled": true, "groups": N, "guests": N, "guestMode": true|false }
```

Bot commands: `/watch /near /unwatch /listen /status` (groups), `/start /stop`
(linking), `/ride /myposts /cancelpost /exportkey /forgetme` (guest mode).

## Geohash radius note

Nostr relay filters match tag values **exactly** — no prefix/radius operator. `nostr_search_intents` filters by topic (`#t`) at the relay and refines distance **client-side** via haversine on each post's `g` tag. To push radius filtering to the relay (`relaySideGeohash: true`), posts must carry **multi-precision geohash prefix tags**; today they carry a single precision-6 `g`, so relay-side geohash is opt-in and a no-op until publishers add prefix tags.
