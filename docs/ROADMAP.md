# Freeport — Roadmap / Deferred work

Items intentionally postponed, with enough context to pick them up later.

## Lock-screen live progress (Live Activity) — deferred until native build

**Goal:** show deal/trip progress on the phone lock screen + Dynamic Island
(like mainstream ride-hailing apps), driven by the existing fulfillment stages
(Confirmed → Picked up → Completed).

**Why deferred:** not possible in the current targets.
- Web (Cloudflare Pages PWA): browsers have no API to draw on the lock screen — never possible. Only ordinary web push.
- Expo Go: sandbox, can't run custom native modules.

**How to do it when ready (no webview wrap — build native from this same RN codebase):**
1. Leave Expo Go → set up **EAS Build** (dev + production), or eject to bare workflow.
2. **iOS:** ActivityKit Live Activity = a small Swift widget extension. Use a
   community lib (`expo-live-activity` / `react-native-live-activity`) to
   start/update from JS. Requires iOS 16.1+ and an **Apple Developer account ($99/yr)**.
3. **Android (cheaper/faster, do first to prove the concept):** foreground
   service + ongoing notification with a progress bar, via Notifee or
   expo-notifications.
4. Wire the fulfillment stage transitions (DealsTab `setStageFor`) to
   start/update/end the activity.

**Key constraint — no backend:** Freeport is pure P2P/Nostr with no server.
Remote Live Activity updates need APNs/a push server. Without one, updates are
**local only** (while the app is running/backgrounded — e.g. the driver taps
"Picked up" → widget updates). To update after the app is fully closed, we'd
need a small push relay. Acceptable v1: local updates only.

**Consequence:** the app would split into two targets sharing one codebase —
**web** (no lock-screen) and a **native EAS build** (has it).

Decision (2026-06): keep web + Expo Go for now; revisit when we commit to a
native build.

Update (2026-07): native EAS builds now exist (App Store + Play). The remaining
work is just the widget extension + stage wiring above; local-only updates
still apply (no push server).

## Advanced marketplace features (multi-stop, delivery batching, ride pooling)

No central dispatcher in Freeport, so each of these is re-expressed as
peer-side logic + small protocol conventions — matching quality scales with
local intent liquidity, not with an optimizer. Recommended order:

### 1. Multi-stop rides — small
- Add an ordered `stops` array to the intent template alongside `from`/`to`
  (older clients ignore it and still see the primary pair — backward compatible).
- Price negotiation unchanged. UI: stop list editor in the post form, stops
  rendered on the deal card / route link.

### 2. Delivery intents + driver-side batching — medium
- **Scope**: peer courier marketplace (pickup at X, drop at Y, what item, who
  fronts the goods payment), NOT integrated food ordering. Menus/restaurant
  POS/payments need a central operator — non-goal.
- New intent kind/template for deliveries (size/weight class, declared value,
  who-pays-goods flag).
- **Batching is client-side only**: a driver holds N independent deals. The
  driver agent scans open delivery intents, scores route compatibility against
  the currently-committed corridor (geohash prefixes + existing haversine
  helpers), auto-counters compatible ones. No protocol change — deals stay 1:1.

### 3. Ride pooling (shared car) — hard, needs liquidity first
- Rider opts in with a `shareable` flag (accepts co-riders for a lower price).
- Driver-side matching: driver with confirmed deal A sees compatible intent B
  (route overlap + time window) → counters B at share pricing. Deals remain
  pairwise; the driver simply holds two.
- Hard parts are UX/incentives, not protocol: route-detour consent, fair split,
  cancellation of one leg, and enough same-area intents for matches to exist.
  Revisit once real usage clusters somewhere.

## More ride-hailing-parity features

Same constraint as above: everything must work as peer-side logic over public
relay data. Roughly ordered by value-for-effort:

### Driver destination mode / corridor intents — the P2P killer feature
- A driver posts "driving A → B at 17:00, 3 seats" as an OFFER intent with a
  route corridor (geohash prefixes along the path); riders along it match in.
- This IS intercity carpool (BlaBlaCar-style) — a market the big apps leave
  open, and the mode where P2P liquidity is easiest to bootstrap (long routes,
  planned in advance, price-sensitive riders).
- Mostly reuses existing matching; needs corridor-geohash generation from a
  route polyline + an offer-side post form.

### Scheduled & recurring rides — small/medium
- Schedule on the intent (post now, window in the future) largely exists;
  recurring ("every weekday 07:30") = client-side scheduler that re-posts the
  template each cycle. Commitment/no-show risk is handled by the existing
  karma/receipts, not escrow.

### Attribute tags + filters — small, high match quality
- Intent tags: child seat, pet-friendly, wheelchair accessible, quiet ride,
  women-only preference, luggage size. Client-side filters on browse/notify.
  Pure template + UI work; no protocol change.

### Demand heatmap for drivers — small/medium, pure client-side
- Aggregate open-intent density by geohash from the relays the client already
  reads and render a heat layer on the map. No server, no new data exposure
  (intents are already public). A "pro" feature for drivers that stays P2P.

### Safety kit — medium
- SOS button: quick-dial local emergency number + auto-share the live trip to
  pre-chosen trusted contacts (live-trip sharing already exists).
- Route-deviation alert: compare live position against the expected route
  client-side; nudge the rider ("off route — everything OK?") with one-tap SOS.

### Hourly charter / rental — small
- Intent type with per-hour pricing terms (car + driver for N hours). Template
  + UI only; negotiation flow unchanged.

### In-chat auto-translate — medium, privacy-sensitive
- 56 UI locales already exist; translating chat between two people needs a
  translation engine. On-device model preferred; a cloud API must be explicit
  opt-in per chat (it leaks message content to a third party — surface that).

### Non-goals (need a central operator)
CUSTODIAL wallets/escrow (self-custodial payments are planned — see below),
surge pricing (Freeport is free negotiation), loyalty programs, trip
insurance, centralized driver vetting.

## Self-hosted OTA updates on Cloudflare (drop the EAS Update dependency)

**Goal:** serve JS OTA updates from our own Cloudflare infrastructure instead
of Expo's EAS Update service — no MAU/bandwidth limits, no dependency on
Expo staying up (or friendly), same censorship-resilience story as the rest
of the stack (web on CF Pages, mirrors on IPFS).

**Why it works:** the client side is open. `expo-updates` speaks the
documented **Expo Updates protocol** (protocol v1) against any conforming
server — `updates.url` in app.json can point anywhere. Expo's hosted service
is convenience, not lock-in.

**Sketch:**
1. **Server = static files + a thin Worker.** `npx expo export` produces the
   update bundles/assets. Upload to R2 (or straight onto Pages); a small
   Worker implements the manifest endpoint (headers: runtime version →
   pick the right update; `expo-protocol-version: 1`, multipart manifest).
   Community reference implementations exist (`expo-updates-server`,
   `custom-expo-updates-server`) — port one to Workers/R2.
2. **Code signing (the important part):** generate our own key pair, ship the
   cert in the binary (`updates.codeSigningCertificate`), sign every manifest.
   Clients then verify updates cryptographically — a compromised CDN/domain
   cannot push code, which matters extra since wallet keys live in the app.
3. **Deploy script:** extend `deploy-web.sh` / a sibling `deploy-ota.sh` —
   export per runtime (1.4.1 / 1.5.0 / 1.5.1 …), sign, upload to R2, purge
   cache. Keep channels (production/preview) as URL paths.
4. **Migration:** needs a NEW binary release with `updates.url` pointed at
   e.g. `https://ota.freeport.network/manifest` + our cert. Old installs keep
   pulling from EAS until they upgrade — run both rails during the overlap
   (the deploy script pushes to EAS *and* R2 until EAS-pointing installs age out).
5. Nice-to-have once live: pin each update bundle to IPFS like the other
   artifacts; a self-hosted binary could even fall back to a gateway.

**Effort:** medium — the export/protocol pieces are documented; the real work
is the Worker manifest endpoint, signing setup, and a careful two-rail
migration. Zero app-code changes beyond app.json config.

Settlement without becoming a money transmitter: the app NEVER holds funds.
The protocol's reserved `payment` field (v1) makes this additive.

**Architecture: a PLUGGABLE wallet layer** (`src/wallet/`), not a hard Breez
dependency. One `WalletProvider` interface — `capabilities()` (assets,
receive/send methods), `balance()`, `receive()` (bolt11 / Spark address),
`pay(invoiceOrAddress)`, events — with two implementations:

1. **`breez-spark` (default)**: the embedded self-custodial wallet below —
   zero-setup UX for users who have no wallet (the majority).
2. **`nwc` (NIP-47 Nostr Wallet Connect)**: bring-your-own wallet (Alby Hub,
   coinos, Primal, self-hosted nodes…). Pairs naturally with the existing
   nostr-tools stack; the user pastes/scans an NWC connection string in
   Settings. Capability-gated: NWC is Lightning-BTC-only, so stablecoin
   balance/denomination UI hides itself when this provider is active.

Settings: "Wallet → Built-in (default) / Connect your own (NWC)". The deal
"Pay" flow talks only to the interface, so providers are interchangeable and
a future provider (e.g. another L2) is additive.

**Default provider: Breez SDK — Nodeless (Spark implementation).**
- One wallet, two assets: Lightning BTC + native stablecoins (USDT/USDB on
  Spark); balance can be HELD in USD — the right default for ride/service
  pricing (no BTC volatility between deal and settle).
- Spark↔Spark transfers are instant and zero-fee — ideal when both deal
  parties use the Freeport wallet; Lightning interop covers everyone else.
- Self-custodial and nodeless (no channel management); wallet key derived
  from the user's existing Nostr key — the current account backup already
  backs up the wallet (one seed story).
- Verified v0.18.0 (2026-07): official WASM builds exist → all four surfaces
  work (iOS/Android/web/desktop). Web lazy-loads the 4.5 MB gz core only when
  the wallet is opened. Size impact per platform ≈ +5–8 MB download
  (iOS arm64 slice / Android per-ABI); exclude from the offline single-file
  build.

**Trust caveat (document honestly in-app):** Spark is a young (2025)
statechain-based L2 — trust-MINIMIZED, not trustless (operators must delete
old keys). Acceptable for spending-wallet amounts; nudge users to keep
balances small ("this is a spending wallet").

**Status (2026-07):** implemented behind Settings → Experimental → Wallet.
Both providers live in `src/wallet/` (NWC + breez-spark, seed derived from
the Nostr key via SHA-256 domain tag `freeport-wallet-v1`). Breez lazy-loads:
web splits the glue into an async chunk and fetches the wasm (copied to
`public/` on postinstall) only when the tab opens; native guards the dynamic
import so pre-Breez binaries fall back to "coming in a future app update".
Requires `EXPO_PUBLIC_BREEZ_API_KEY` at build time; without it only NWC shows.

**Rollout:**
1. PoC first: EAS build one target, measure real IPA/AAB delta, send/receive
   USDT between two devices, verify WASM on web + Tauri.
2. Ship behind a feature flag in ONE pilot market; soft balance-cap nudge.
3. Also ship the trivial fallback everywhere: payment address (lud16 / Spark
   address) in the profile + "Pay" deep link on confirmed deals — covers
   users of external wallets and any surface where the SDK lags.
4. GATE: written legal sign-off (self-custody software exemptions, e.g. SG
   PSA) BEFORE any public rollout. No escrow, ever — that flips the model to
   custodial.

Deliberately skipped: custodial options (Cashu mints, exchange APIs) —
they conflict with the no-operator model.
