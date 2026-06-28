# Freeport Nostr MCP + Push Notifier

A self-hostable server for [Freeport](https://freeport.trinh.uk), the
decentralized P2P marketplace on Nostr. One process, two jobs:

1. **MCP endpoint** (`/mcp`) — a read-only [Model Context Protocol](https://modelcontextprotocol.io)
   server that lets AI agents search Freeport's Nostr events: ride/service/goods
   requests and offers, reputation, and profiles, filtered by kind, tag, and
   geohash radius.
2. **Push notifier** (`/subscribe`, `/vapidPublicKey`, `/unsubscribe`) — watches
   the relays and pushes new matching intents and DMs to subscribers, over **Web
   Push** (browsers / PWA) and **Expo Push** (native iOS/Android).

Run your own and you become an independent MCP host *and* notification host for
the network — no central server required.

## Quick start (Docker)

```bash
git clone https://github.com/ptrinh/freeport.git
cd freeport/server
cp .env.example .env        # optional: edit VAPID_SUBJECT, relays, limits
docker compose up -d
```

Then:

- MCP endpoint: `http://localhost:8788/mcp`
- Health: `http://localhost:8788/health`

`docker compose` builds the image from source on first run.

## Endpoints

| Route | Method | Purpose |
|-------|--------|---------|
| `/mcp` | POST | MCP (streamable HTTP) — the query tools below |
| `/health` | GET | Liveness + notifier status (unauthenticated, unthrottled) |
| `/vapidPublicKey` | GET | VAPID public key for Web Push subscription |
| `/subscribe` | POST | Register a push subscription (Web Push or Expo token) |
| `/unsubscribe` | POST | Remove a push subscription |

### MCP tools

- `nostr_search_intents` — ride/service/goods requests & offers by kind, tag, geohash radius
- `nostr_reputation` — karma / deal-receipt history for a pubkey
- `nostr_profile` — a pubkey's profile (kind 0)
- `nostr_get_event` — fetch one event by id
- `nostr_query_raw` — generic relay filter (advanced)
- `freeport_create_post` — **write** (optional, off unless `ENABLE_WRITE=1`): publish an offer/request. Provide a dedicated agent `secretKey` (server builds + signs; the key is used transiently and never stored/logged) **or** a pre-signed `event` (keyless). Strict per-key + global write rate limits apply.

Read tools accept a per-call `relays` override (capped by `MAX_RELAYS`).

## Configuration

All via environment variables (see `.env.example`):

| Var | Default | Notes |
|-----|---------|-------|
| `HOST` / `PORT` | `0.0.0.0` / `8788` | bind address |
| `RATE_LIMIT_PER_MIN` | `300` | per-IP sustained rate |
| `RATE_LIMIT_BURST` | `60` | per-IP burst |
| `RATE_LIMIT_GLOBAL_PER_MIN` | `2500` | server-wide ceiling |
| `FREEPORT_RELAYS` | built-in set | comma-separated relay URLs |
| `MAX_RELAYS` | `12` | cap on per-request relay overrides |
| `ENABLE_NOTIFY` | `1` | set `0` for an MCP-only server |
| `DATA_DIR` | `/data` | where push subscriptions persist |
| `VAPID_SUBJECT` | — | `mailto:` for Web Push |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | auto-generated | pin them so subscriptions survive a restart |

Generate a VAPID key pair:

```bash
docker compose run --rm freeport-nostr-mcp \
  node -e "console.log(require('web-push').generateVAPIDKeys())"
```

## Run on Umbrel

Available as an Umbrel app. Add the community app store
(`https://github.com/ptrinh/freeport-umbrel-app-store`) in Umbrel →
**App Store → Community App Stores**, then install **Freeport Nostr MCP**.

## Without Docker

Requires Node 20+.

```bash
npm install
npm run build
node packages/nostr-mcp/dist/http.js      # HTTP server (MCP + notifier)
```

There's also a stdio MCP entry for local agent use, published on npm:

```bash
npx freeport-nostr-mcp                     # stdio MCP server
```

## Layout

```
packages/protocol/    Freeport Nostr protocol (event kinds, geohash, parsing)
packages/nostr-mcp/   the MCP server + push notifier (src/notify/)
Dockerfile            builds protocol + nostr-mcp
docker-compose.yml    one-command run
```

## License

MIT
