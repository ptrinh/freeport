# Contributing

## Setup

```sh
npm install                     # workspace packages (protocol, agent, freeport-self-hosted)
npm install --prefix apps/mobile  # the Expo app has its own tree
npm run build && npm test       # build packages, run all four test suites
```

Node 22+ (nostr-tools needs the global `WebSocket`).

## Layout

| Path | What |
|---|---|
| `docs/protocol.md` | Protocol spec: intent event kinds (32101/32102), negotiation envelopes, state machine |
| `packages/protocol` | Spec as code: event build/parse, negotiation state machine, matching, geohash |
| `packages/agent` | CLI personal agent (`freeport run`): subscribe, auto-match, negotiate, human confirm |
| `packages/freeport-self-hosted` | Self-hosted Freeport in a box (default port 1988): the web app + read-only MCP server + Web Push / Expo notifier + NIP-01 relay + the **Telegram bridge** (feed, listen mode, pings, guest mode) |
| `apps/mobile` | Expo/React Native + PWA client (post intent, negotiate, confirm deals, built-in Lightning/stablecoin wallet in `src/wallet/`, key backup, 55 locales incl. RTL). UI is split into `apps/mobile/src/tabs/*` (one file per tab) + `apps/mobile/src/ui/*` (theme, shared fields, formatters, alerts); see [`apps/mobile/CONTRIBUTING.md`](apps/mobile/CONTRIBUTING.md) |
| `relay/` | Self-hosted strfry relay (docker-compose, Proxmox-LXC-sized, Uptime-Kuma health) |
| `demo/` | Two-agent rideshare demo configs + script |

The protocol package is the spec as code — change `docs/protocol.md` and
`packages/protocol` together.

## Stack decisions

- **TypeScript + nostr-tools** (over Rust): mature NIP coverage (01/04/19/40/44/49),
  same language across protocol/agent/mobile so the protocol package is shared
  verbatim, fastest iteration to demo.
- **Demo vertical: `sg-rideshare`** (Singapore rideshare) — the protocol is
  vertical-agnostic; verticals are payload schemas (`rideshare/1`) plus a
  client-side matcher.
- **Intents public, negotiations encrypted** (NIP-04 now, NIP-17 next).
- **Settlement is self-custodial only**: the built-in wallet never holds funds
  and there is no escrow — deals still end with contact exchange, payment is a
  convenience layered on the reserved `payment` field.

## Quick start (agents + demo)

```sh
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

## Tests

Every package has a vitest suite; `npm test` at the root runs all of them and
CI (`.github/workflows/ci.yml`) runs the same on every push/PR plus a mobile
typecheck. Multi-client integration tests live in `apps/mobile/test/` on an
in-process fake relay (`fake-relay.ts`) — real keys, real NIP-04, only the
network faked. New negotiation/protocol behavior should come with one.

## Style

- TypeScript throughout; match the file you're in.
- Comments explain constraints the code can't (`why`, not `what`).
- UI strings go through `t()`/`tn()` — add new keys to the locale catalogs in
  `apps/mobile/src/locales/` (read `GLOSSARY.md` there first).
- Layout styles use logical properties (`marginStart`, not `marginLeft`) —
  the app supports RTL.

## Non-goals

Check the README's non-goals before proposing payments/escrow, reputation
weighting changes, or moderation policy — some omissions are deliberate v1
scope, and moderation lists are a per-community decision.
