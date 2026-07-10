# Contributing

## Setup

```sh
npm install                     # workspace packages (protocol, agent, freeport-self-hosted)
npm install --prefix apps/mobile  # the Expo app has its own tree
npm run build && npm test       # build packages, run all four test suites
```

Node 22+ (nostr-tools needs the global `WebSocket`).

## Layout

See the table in [README.md](README.md). The protocol package is the spec as
code — change `docs/protocol.md` and `packages/protocol` together.

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
