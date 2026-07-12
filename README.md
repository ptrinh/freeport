# Freeport

[![CI](https://github.com/ptrinh/freeport/actions/workflows/ci.yml/badge.svg)](https://github.com/ptrinh/freeport/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![App Store](https://img.shields.io/badge/App_Store-iOS-000000?logo=apple&logoColor=white)](https://apps.apple.com/us/app/freeport-p2p-marketplace/id6781200901)
[![Google Play](https://img.shields.io/badge/Google_Play-Android-414141?logo=googleplay&logoColor=white)](https://play.google.com/store/apps/details?id=uk.trinh.freeport)
[![Web app](https://img.shields.io/badge/web-freeport.network-2ea44f)](https://freeport.network)
[![Protocol: Nostr](https://img.shields.io/badge/protocol-Nostr-8e44ad)](https://nostr.com)

Decentralized P2P marketplace over Nostr. Users broadcast trade intents into
topic-scoped markets; personal agents discover counterpart intents and
negotiate automatically. Humans confirm final deals. No central operator, no
matching server — relays are dumb pub/sub, all logic is client-side.

- **App:** https://freeport.network (web/PWA) · [iOS](https://apps.apple.com/us/app/freeport-p2p-marketplace/id6781200901) · [Android](https://play.google.com/store/apps/details?id=uk.trinh.freeport) · [Desktop — Mac/Windows/Linux](https://github.com/ptrinh/freeport/releases/latest) · [Offline HTML](https://github.com/ptrinh/freeport/releases/latest/download/Freeport-offline.html)
- **Whitepaper:** [PDF](https://freeport.network/intro/whitepaper.pdf)
- **Self-host all of Freeport:** [`packages/freeport-self-hosted`](packages/freeport-self-hosted) — `docker compose up -d` serves the web app + read-only MCP + content-blind push notifier + a Nostr relay + the optional Telegram bridge on port 1988. The app needs no backend; this is for communities who want their own node.

## Layout

| Path | What |
|---|---|
| `docs/protocol.md` | Protocol spec: intent event kinds (32101/32102), negotiation envelopes, state machine |
| `packages/protocol` | Spec as code: event build/parse, negotiation state machine, matching, geohash |
| `packages/agent` | CLI personal agent (`freeport run`): subscribe, auto-match, negotiate, human confirm |
| `packages/freeport-self-hosted` | Self-hosted Freeport in a box (default port 1988): the web app + read-only MCP server + Web Push / Expo notifier + NIP-01 relay + the **Telegram bridge** (feed, listen mode, pings, guest mode) |
| `apps/mobile` | Expo/React Native + PWA client (post intent, negotiate, confirm deals, built-in Lightning/stablecoin wallet, key backup, 55 locales incl. RTL). UI is split into `apps/mobile/src/tabs/*` (one file per tab) + `apps/mobile/src/ui/*` (theme, shared fields, formatters, alerts); see [`apps/mobile/CONTRIBUTING.md`](apps/mobile/CONTRIBUTING.md) |
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
- **Settlement is self-custodial only**: the built-in wallet (below) never
  holds funds and there is no escrow — deals still end with contact exchange,
  payment is a convenience layered on the reserved `payment` field.

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

### Desktop app CLI (headless host)

The desktop app ([GitHub Releases](https://github.com/ptrinh/freeport/releases))
ships with a **full copy of the Freeport web app embedded** — it runs entirely
on its own, without freeport.network or any hosted infrastructure, talking
straight to the public Nostr relays. That same embedded copy makes it a
**self-host kit for Freeport itself**: it doubles as a headless server that
serves the app to people on your network from a terminal, a VPS, or systemd,
no window needed. If freeport.network ever disappeared, every desktop install
would keep working and could host the app for others:

```sh
# macOS (or symlink it: sudo ln -s /Applications/Freeport.app/Contents/MacOS/Freeport /usr/local/bin/freeport)
/Applications/Freeport.app/Contents/MacOS/Freeport --serve
# Linux (.deb installs to /usr/bin)
freeport --serve
# Windows
"C:\Program Files\Freeport\Freeport.exe" --serve
```

```
--serve                            host the web app on your LAN, headless (no window)
--port <PORT>                      port to host on (default 1988)
--notify                           also host the notification/MCP server + a Nostr relay
--telegram-token <T>               run the Telegram bridge with this bot token (implies --notify)
--telegram-guest-passphrase <P>    enable custodial guest mode (advanced; holds keys for guests)
-v, --version / -h, --help
```

It prints the LAN URLs to share (`http://192.168.x.x:1988`) and, with
`--notify`, a relay URL to add to the app's relay list. Ctrl-C stops it. The
same server is available from the GUI under **Features → Host Freeport for
others**.

## Status

- **Distribution**: live on the [Apple App Store](https://apps.apple.com/us/app/freeport-p2p-marketplace/id6781200901)
  and [Google Play](https://play.google.com/store/apps/details?id=uk.trinh.freeport);
  web at [freeport.network](https://freeport.network). Desktop installers on
  [GitHub Releases](https://github.com/ptrinh/freeport/releases/latest) —
  macOS (`.dmg`, Apple Silicon + Intel, signed & notarized), Windows (`.exe`/`.msi`,
  x64 — runs on ARM via emulation), Linux (`.deb`, x64 + arm64) — with built-in
  self-update on macOS/Windows — plus a **single-file offline copy**
  (`Freeport_x.y.z-offline.html`): the whole app, fonts and all 56 languages in
  one HTML file that runs from `file://` with no install and no server.
- **Wallet (experimental)**: built-in **self-custodial Bitcoin Lightning +
  stablecoin (USDT/USDB) wallet** via [Breez SDK](https://breez.technology)
  (Spark), lazy-loaded and enabled in Settings → Features. Wallet keys derive
  from your Nostr key — one backup covers identity and funds. Lightning
  address (`you@freeport.network`), bolt11, on-chain, QR scan, contacts, and
  balances shown in your local currency. Deal integration: once a deal is
  confirmed the buyer gets a **Pay** button and the seller a **Pay QR** with
  the agreed amount auto-converted from fiat to sats. Prefer your own wallet?
  Connect it over **NWC (NIP-47)** instead. Spark is a young trust-minimized
  L2 — treat it as a spending wallet (`apps/mobile/src/wallet/`).
- **Reputation**: implemented — karma ratings (PoW-backed, `apps/mobile/src/karma.ts`),
  deal receipts, proven-deal counts, per-viewer web-of-trust weighting, and a
  `nostr_search_reputation` MCP tool. What remains open is *sybil resistance*:
  a new keypair is free, so zero-history identities should be treated with
  visible caution by clients.
- **Notifications & Telegram**: content-blind Web Push / Expo push, plus a
  **Telegram bridge** — relay a market feed into groups, parse organic "hitcher"
  posts into a one-tap broadcast, send personal activity pings, and (optional,
  custodial) let Telegram-native users post and deal without the app. All
  self-hostable in `packages/freeport-self-hosted` — see its README to enable.
- **Localization**: 55 languages with plural-aware strings and full RTL
  (Arabic, Hebrew, Persian, Urdu).

## Non-goals (v1)

Escrow/custody (payments are self-custodial wallet-to-wallet only), dispute
resolution, vetting, anti-sybil — all deliberately deferred.

## License & forking

MIT ([LICENSE](LICENSE)). Freeport exists to be forked: any community can
stand up its own market — own name, city, vertical, relays and services — by
changing configuration, not architecture. **[FORKING.md](FORKING.md)** lists
every deployment-specific value; [CONTRIBUTING.md](CONTRIBUTING.md) covers
dev setup and style.
