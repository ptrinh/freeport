# eSIM Demo Shop — Freeport mini-app example

A single-file demo mini-app for the Freeport mini-app shell (NIP-07 + WebLN +
`window.freeport.paySpark`). Published at **https://apps.freeport.network/esim-store/**
by `apps/mobile/deploy-web.sh`.

Try it: Freeport app → Settings → Experimental → enable **Mini-apps** →
add `apps.freeport.network/esim-store` (pasting this repo's GitHub URL works too).

What it demonstrates:

- **Sign in with Freeport** — `window.nostr.getPublicKey()`; the shell shows a
  native approval dialog, the page never sees the private key.
- **Free eSIM (0 sats)** — no payment; issues a fake activation code derived
  from the buyer's pubkey.
- **Global eSIM (5 USDT)** — `window.freeport.paySpark({address, token:
  {ticker: 'USDT', amount: 5}})`; the wallet pays a Spark address in a
  stablecoin after a per-payment native approval (spend caps never auto-allow
  Spark payments).

Everything is fake except the bridge calls: no eSIM is provisioned, and the
payment goes to a demo address. The page is fully self-contained (no external
scripts) and works as a plain website outside the shell, where it shows
instructions instead of the shop.
