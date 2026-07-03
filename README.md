# Freeport

Decentralized P2P marketplace over Nostr. Users broadcast trade intents into
topic-scoped markets; personal agents discover counterpart intents and
negotiate automatically. Humans confirm final deals. No central operator, no
matching server — relays are dumb pub/sub, all logic is client-side.

> Naming: "Freeport" pending trademark/domain check — all naming is held in
> `packages/protocol/src/constants.ts` (`APP_NAME`).

- **App:** https://freeport.trinh.uk (web/PWA) · [iOS](https://apps.apple.com/us/app/freeport-p2p-marketplace/id6781200901) · Android
- **Whitepaper:** [English](docs/whitepaper.pdf) · [Tiếng Việt](docs/whitepaper.vi.pdf)
- **Self-host the server:** [`packages/nostr-mcp`](packages/nostr-mcp) — `docker compose up -d` (MCP + push notifier + optional Telegram bridge)

## Layout

| Path | What |
|---|---|
| `docs/protocol.md` | Protocol spec: intent event kinds (32101/32102), negotiation envelopes, state machine |
| `packages/protocol` | Spec as code: event build/parse, negotiation state machine, matching, geohash |
| `packages/agent` | CLI personal agent (`freeport run`): subscribe, auto-match, negotiate, human confirm |
| `packages/nostr-mcp` | Read-only MCP server for agents + self-hostable notifier: Web Push / Expo push and the **Telegram bridge** (feed, listen mode, pings, guest mode) |
| `apps/mobile` | Expo/React Native + PWA client (post intent, negotiate, confirm deals, key backup, 55 locales incl. RTL) |
| `relay/` | Self-hosted strfry relay (docker-compose, Proxmox-LXC-sized, Uptime-Kuma health) |
| `demo/` | Two-agent rideshare demo configs + script |

## Stack decisions

- **TypeScript + nostr-tools** (over Rust): mature NIP coverage (01/04/19/40/44/49),
  same language across protocol/agent/mobile so the protocol package is shared
  verbatim, fastest iteration to demo.
- **Demo vertical: `sg-rideshare`** (Singapore rideshare) — the protocol is
  vertical-agnostic; verticals are payload schemas (`rideshare/1`) plus a
  client-side matcher.
- **Intents public, negotiations encrypted** (NIP-04 now, NIP-17 next).
- **Settlement out of scope for v1**: deals end with contact exchange; a
  reserved `payment` field lands Lightning later without breaking changes.

## Quick start

```sh
npm install
npm run build && npm test           # protocol unit tests
cd packages/agent && npm test       # e2e: 2 agents + in-process relay

# live demo over public relays (driver bg + rider fg, answer y to confirm):
bash demo/run-demo.sh
```

Two-machine demo (the real thing):

```sh
# machine B (driver)
npx tsx packages/agent/src/cli.ts run --config demo/driver.config.json
# machine A (rider) — different relay set, overlaps on one relay
npx tsx packages/agent/src/cli.ts run --config demo/rider.config.json --post demo/ride-request.json
```

Agent A posts a 15:45 ride request → B discovers it, counters 16:00 (its
configured window) → A's owner answers `y` → both print the confirmed deal
with exchanged contacts. Verified end-to-end over `damus.io / nos.lol /
primal.net / nostr.band / nostr.mom`.

## CLI

```
freeport whoami                          show/create identity (silent keygen)
freeport backup --passphrase <pw>        NIP-49 encrypted key backup
freeport restore --blob <ncryptsec> --passphrase <pw>
freeport post --intent <file.json>       publish an intent
freeport listen --market <topic>         watch a market
freeport run --config <agent.json>       full agent loop [--post intent.json] [--yes]
```

## Status

- **Distribution**: live on the Apple App Store; Google Play in review.
- **Reputation**: implemented — karma ratings (PoW-backed, `apps/mobile/src/karma.ts`),
  deal receipts, proven-deal counts, per-viewer web-of-trust weighting, and a
  `nostr_search_reputation` MCP tool. What remains open is *sybil resistance*:
  a new keypair is free, so zero-history identities should be treated with
  visible caution by clients.
- **Notifications & Telegram**: content-blind Web Push / Expo push, plus a
  **Telegram bridge** — relay a market feed into groups, parse organic "hitcher"
  posts into a one-tap broadcast, send personal activity pings, and (optional,
  custodial) let Telegram-native users post and deal without the app. All
  self-hostable in `packages/nostr-mcp` — see its README to enable.
- **Localization**: 55 languages with plural-aware strings and full RTL
  (Arabic, Hebrew, Persian, Urdu).

## Non-goals (v1)

Payments/escrow, dispute resolution, vetting, anti-sybil — all deliberately
deferred.

## License & forking

MIT ([LICENSE](LICENSE)). Freeport exists to be forked: any community can
stand up its own market — own name, city, vertical, relays and services — by
changing configuration, not architecture. **[FORKING.md](FORKING.md)** lists
every deployment-specific value; [CONTRIBUTING.md](CONTRIBUTING.md) covers
dev setup and style.
