# Arbitrator — mini-app example

A single-file demo mini-app for **escrow dispute arbitration** on the Freeport
P2P marketplace. An arbitrator is a Nostr identity (**npub**) that resolves
disputes: happy path (buyer and seller both agree) the arbitrator earns
**nothing**; on a dispute it decides and earns a fee. Published at
**https://apps.freeport.network/arbitrator/**.

Try it: Freeport app → **Apps** tab → **Add App** → scan the QR below (or the
**QR button** in the add sheet), or paste `apps.freeport.network/arbitrator`
(the repo's GitHub URL works too):

<img src="qr.png" alt="Scan to add the Arbitrator mini-app" width="200" />

(Requires **Mini-apps** enabled in Settings → Experimental.)

## Flow (3 tabs)

1. **Create escrow** — drafts a *specimen* escrow contract from buyer npub
   (prefilled from `window.nostr.getPublicKey()`), seller npub, arbitrator npub,
   and a trade amount. It mints a deterministic 64-hex transaction event id and
   a watermarked contract card. **No funds are held** (see the multisig note
   below).
2. **Open dispute** — paste (or reuse) the transaction id, pick your role
   (buyer/seller), write textual evidence and optionally attach an image (a
   canvas-drawn specimen is available; the image never leaves the page
   unencrypted). The page encrypts the evidence, composes a **kind 32105**
   dispute event, gets it signed via `window.nostr.signEvent()`, shows the
   signed JSON with a copy button, and lets the **opener stake the fee** via
   `window.freeport.paySpark({ token: { ticker: 'USDT', amount } })`. When the
   fee is 0 the payment step is skipped entirely.
3. **Arbitrator dashboard** — lists the case files opened this session (grouped
   by trade, showing both sides' decrypted evidence), with
   **Release to buyer** / **Release to seller** verdict buttons that produce a
   signed **kind 32106** verdict event (e-tagging the dispute) plus a mock
   payout receipt.

## What's real vs. mocked

- **Real:** the Nostr events (kind 32105 dispute, kind 32106 verdict), their
  signatures, and the evidence encryption.
- **Mocked:** the escrow itself (clearly watermarked *"specimen escrow — no real
  funds held"*), and any fee payment goes to a demo donation address.

## The multisig reality

The original idea was a 2-of-3 multisig escrow (buyer, seller, arbitrator). WebLN
/ Spark **cannot** do a real 2-of-3 multisig, so this demo models escrow as
*"the arbitrator holds the hold-invoice preimage"*: happy path both parties
signal completion → auto-release; dispute → the arbitrator settles to the seller
or refunds the buyer. The demo does not hold funds at all.

## The fee model

The dispute fee is **2% of the trade amount, capped at 20 USDT**. The dispute
**opener stakes it up front** — this is anti-spam and neutral (a real deployment
reimburses the winner from the loser's share; the demo just states this). If the
computed fee is 0, the `paySpark` step is skipped, so the whole flow is testable
without funds — the firewall hard-denies a zero-amount `paySpark`, so the app
must never call it with amount 0.

## Reputation: karma is the license

This mini-app is **UI only** — the reputation attaches to the *operator's
pubkey*. The arbitrator's npub accumulates normal Freeport **karma** as both
parties rate each verdict. A biased arbitrator bleeds karma and stops being
chosen; a fair one earns a reputation that is its license to keep arbitrating.
Because karma/ratings are public Nostr data derivable from the npub, the bridge
does not hand them over — a production build would look them up from relays.

## Evidence encryption

Evidence is encrypted with a random **AES-GCM** symmetric key (WebCrypto). That
key is then wrapped for **all three** p-tag pubkeys (buyer, seller, arbitrator)
so each party can re-open its own case file — not just the arbitrator. When the
Freeport bridge exposes NIP-44 (`window.nostr.nip44.encrypt`, which it does — the
shim wires `nip44.encrypt`/`nip44.decrypt` through to the native signer's
conversation key), the key is wrapped per-recipient with it. If a future SDK ever
dropped NIP-44, the page falls back to a clearly-labelled **demo-only** wrap that
embeds the key unwrapped — never mistake it for real. Each NIP-44 wrap raises one
bridge approval dialog (per-peer `encrypt` grant), so opening a dispute prompts
up to three "encrypt to peer" approvals.

The page is fully self-contained (bech32 npub encode **and** decode, AES-GCM
envelope, deterministic tx-id hashing — no CDN, strict CSP) and works as a plain
website outside the shell, where it shows instructions instead of the service.

Full bridge architecture & threat model:
[`docs/miniapps-security.md`](../../docs/miniapps-security.md).
