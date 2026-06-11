# Freeport

Decentralized P2P marketplace over Nostr. Users broadcast trade intents into
topic-scoped markets; personal agents discover counterpart intents and
negotiate automatically. Humans confirm final deals. No central operator, no
matching server — relays are dumb pub/sub, all logic is client-side.

> Naming: "Freeport" pending trademark/domain check — all naming is held in
> `packages/protocol/src/constants.ts` (`APP_NAME`).

## Layout

| Path | What |
|---|---|
| `docs/protocol.md` | Protocol spec: intent event kinds (32101/32102), negotiation envelopes, state machine |
| `packages/protocol` | Spec as code: event build/parse, negotiation state machine, matching, geohash |
| `packages/agent` | CLI personal agent (`freeport run`): subscribe, auto-match, negotiate, human confirm |
| `apps/mobile` | Minimal Expo/React Native client (post intent, confirm deals, key backup) |
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

## Non-goals (v1)

Payments/escrow, reputation/anti-sybil, dispute resolution, vetting, Telegram
bridge, App Store distribution — all deliberately deferred.
