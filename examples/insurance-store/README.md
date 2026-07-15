# Freeport Insurance Store — mini-app example

A single-file demo mini-app showing a richer bridge flow than the eSIM shop:
identity + private reads + underwriting + a downloadable certificate + payment.
Published at **https://apps.freeport.network/insurance-store/**.

Try it: Freeport app → **Apps** tab → **Add App** → scan the QR below (or the
**QR button** in the add sheet), or paste `apps.freeport.network/insurance-store`
(the repo's GitHub URL works too):

<img src="qr.png" alt="Scan to add the Freeport Insurance Store" width="200" />

(Requires **Mini-apps** enabled in Settings → Experimental.)

Flow:

1. **Pick a policy** — single trip, 24h, 7d, 1 month, 1 year. Base prices are
   internal; the user only ever sees the risk-adjusted premium. **Single trip
   is free** so the whole flow is testable without funds; its certificate is
   stamped with the exact activation time (local + timezone + ISO) alongside
   the npub — together they pin the cover to the holder's single next ride.
2. **Applicant form** — legal name, ID number, date of birth (→ age). The demo
   auto-fills it.
3. **Freeport signals** — the app pulls:
   - `window.nostr.getPublicKey()` → the **npub**.
   - **Public reputation** (karma, ratings, completed deals, account age)
     *derived from the npub*. Because that data is public on Nostr, the bridge
     deliberately does **not** hand it over — the app looks it up itself. The
     demo fakes this in `deriveReputationFromNpub()` (a clearly-marked stub;
     a real app queries relays/its backend).
   - **Private signals** via the bridge, each behind an approval dialog:
     `window.freeport.getLocation()` (coarse region) and
     `window.freeport.getBalance()` (wallet sats). These are *not* on any relay,
     so they can only come from the shell with the user's consent.
4. **Quote** — a **risk coefficient** is computed from age + reputation +
   region + balance, multiplied against the hidden base price. A specimen
   **Certificate of Insurance** renders and downloads as a PDF (built inline,
   no libraries).
5. **Purchase** — `window.freeport.paySpark({token: {ticker: 'USDT', amount}})`
   pays the premium to a donation Spark address (skipped entirely when the
   premium is 0, so no wallet or payment permission is needed); on success the
   certificate is marked paid — with the paid-at timestamp — and downloadable.

Everything is fake: no policy is underwritten, reputation is stubbed, and the
payment goes to a demo address. The page is fully self-contained (bech32 npub
encoder and PDF writer included) and works as a plain website outside the
shell, where it shows instructions instead of the store.

Full bridge architecture & threat model:
[`docs/miniapps-security.md`](../../docs/miniapps-security.md).
