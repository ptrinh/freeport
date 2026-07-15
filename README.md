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
- **Self-host:** [`packages/freeport-self-hosted`](packages/freeport-self-hosted)
  (`docker compose up -d`), or any desktop install can host the app for your
  network with `freeport --serve`.
- **Developers:** [CONTRIBUTING.md](CONTRIBUTING.md) — repo layout, stack
  decisions, quick start, CLI.

## Why Freeport exists

- **It's a research project.** How far can pure P2P infrastructure go? Buyers,
  sellers, riders, drivers meet over Nostr, settle in Lightning or cash.
  Nothing in between needs permission to exist.
- **It's a thesis.** A P2P marketplace with a reputation system works. When
  people own their reputation, the market self-regulates.
- **It's a check and balance.** A zero-fee exit that answers to no one puts a
  ceiling on how greedy the big platforms can get.
- **It's fun.** An open protocol, Claude Code as a pair programmer, no
  investor deck.
- **Nobody profits — including me.** No operator, no cut. A protocol, not a
  platform. Run it or fork it.
- **No one will protect you here — that's the point, and the price.** No
  support line, no refunds, no central authority. Your own judgment is the
  first line of defense — but you're not entirely on your own. The protocol
  gives you tools to lower the risk, all opt-in and none run by an operator:
  a robust [reputation system](#what-works-today) (peer karma, co-signed deal
  receipts, web-of-trust weighting); decentralized escrow **arbitration**
  ([`examples/arbitrator`](examples/arbitrator)) where a mutually chosen
  arbitrator resolves disputes and earns only when one is raised;
  decentralized **ID verification**
  ([`examples/id-verification`](examples/id-verification)) to prove who you're
  dealing with; and **insurance**
  ([`examples/insurance-store`](examples/insurance-store)) priced from
  on-chain reputation. Reputation and these safeguards are the safety net —
  you choose how much of it to use.

## What works today

- **Everywhere**: iOS + Android app stores, web/PWA, desktop installers for
  macOS/Windows/Linux with self-update — plus a **single-file offline copy**:
  the whole app in one HTML file that runs from `file://`, no install, no
  server.
- **Wallet (experimental)**: built-in self-custodial Bitcoin Lightning +
  stablecoin (USDT/USDB) wallet ([Breez SDK](https://breez.technology)/Spark).
  Keys derive from your Nostr key — one backup covers identity and funds.
  Lightning address (`you@freeport.network`), on-chain, QR scan, local-currency
  balances, and one-tap Pay / Pay QR on confirmed deals. Bring your own wallet
  over NWC instead if you prefer. Spark is a young trust-minimized L2 — treat
  it as a spending wallet.
- **Reputation**: peer-rated karma, co-signed deal receipts, proven-deal
  counts, web-of-trust weighting. Sybil resistance stays open — treat
  zero-history identities with caution.
- **Chat**: invite-based 1:1 encrypted chat beyond deals — QR/link invites,
  replies, emoji reactions, disappearing messages, delivery/read receipts,
  voice messages, location sharing, in-chat search and Lightning payments.
  Between updated clients it upgrades to NIP-17 gift wrap, so relays can't
  even see who talks to whom.
- **Calls (experimental)**: peer-to-peer audio/video calls in chat (WebRTC,
  end-to-end encrypted, signaling over encrypted DMs — no call server),
  with screen sharing on web. Optional TURN fallback.
- **Zaps & Shops**: NIP-57 zap tipping on posts (verifiable receipts), and
  NIP-15 storefronts — durable seller listings with a conversational
  "chat with seller" checkout.
- **Escrow without a custodian**: HODL-invoice conditional payments on
  confirmed deals — the buyer holds the preimage, the seller can only settle
  on release, unreleased funds auto-refund. The Lightning protocol enforces
  the lock; nobody ever holds the money in between.
- **Mini-apps (experimental)**: third-party web apps run inside Freeport with
  your portable identity (NIP-07) and wallet (WebLN + Spark/stablecoin) —
  sandboxed behind a permission firewall where every sensitive action needs
  your approval ([architecture & threat model](docs/miniapps-security.md)).
  A dedicated **Apps** tab hosts the launcher — a home-screen-style grid
  (add any app by URL or QR, drag to rearrange), with the wallet as its first
  tile; your apps and their grants travel with the account backup. One
  [`<script>` tag](packages/miniapp-sdk) makes a page work on web too.
  Mini-app examples:
  - [`examples/esim-store`](examples/esim-store) — eSIM shop with
    Spark/stablecoin checkout, live at
    [apps.freeport.network/esim-store](https://apps.freeport.network/esim-store/)
  - [`examples/insurance-store`](examples/insurance-store) — travel insurance
    quotes underwritten from npub-derived reputation, with a downloadable PDF
    certificate, live at
    [apps.freeport.network/insurance-store](https://apps.freeport.network/insurance-store/)
  - [`examples/id-verification`](examples/id-verification) — a paid identity /
    licence verification service: submit documents, book a video call, and get
    a shareable verification link for your profile, live at
    [apps.freeport.network/id-verification](https://apps.freeport.network/id-verification/)
  - [`examples/arbitrator`](examples/arbitrator) — decentralized dispute
    arbitration: an escrow with the arbitrator as a conditional key, encrypted
    evidence (NIP-44), and a fee only charged when a dispute is actually
    raised — the arbitrator's npub karma is their license, live at
    [apps.freeport.network/arbitrator](https://apps.freeport.network/arbitrator/)
- **On-device AI (experimental)**: describe what you need in any language
  and it drafts your post; incoming chat messages auto-translate. Runs
  entirely on your device (Apple Intelligence / Android ML Kit + Gemini
  Nano / Chrome built-in AI) — your words never leave it.
- **Notifications & Telegram**: content-blind push, plus a Telegram bridge —
  market feeds in groups, one-tap broadcast of organic posts, personal pings.
- **56 languages**, full RTL, in-chat translation.

## Non-goals (v1)

Custody (payments stay self-custodial wallet-to-wallet; even escrow is
trust-minimized HODL invoices, never a held balance), dispute resolution,
vetting, anti-sybil — all deliberately deferred.

## Donate

BTC: `bc1ps44wjx3wpu4s0xj746gz2lu45nspsm9059d3ym8xz0nrhu4psyasdgwwhx`

## License & forking

MIT ([LICENSE](LICENSE)). Freeport exists to be forked: any community can
stand up its own market — own name, city, vertical, relays and services — by
changing configuration, not architecture. **[FORKING.md](FORKING.md)** lists
every deployment-specific value; [CONTRIBUTING.md](CONTRIBUTING.md) covers
dev setup and style.
