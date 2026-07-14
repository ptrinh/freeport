# Freeport — Roadmap / Deferred work

Items intentionally postponed, with enough context to pick them up later.

## Ship-ahead policy: native modules + coming-soon switches

Binary releases are slow (store review) but OTA JS updates are instant — so
every binary ships **ahead of the roadmap**: native modules for planned
features are linked now, and the features arrive later as pure-JS OTA pushes.
`runtimeVersion.policy = appVersion` keeps this safe: bump the app version
whenever a native module is added, and OTA updates for the new runtime never
reach old binaries that lack the module.

**Pre-linked as of 1.6.0** (feature JS ships/shipped via OTA):
- `react-native-webrtc` (+ config plugin) — audio/video calls + screen share
  (calls JS has since shipped). Mic/camera permissions were already in the
  manifest.
- `react-native-webview` — for the mini-apps shell (and any embedded web flow).
- `react-native-apple-llm` — Apple Foundation Models (iOS 26+) for the
  on-device AI concierge + chat translate (JS shipped; lights up on eligible
  devices once a 1.6.0+ binary is out).
- `@react-native-ml-kit/translate-text` + `identify-languages` — Android
  on-device translation (ML Kit, 58 languages, ~30MB packs, runs on
  virtually every Android device — no Gemini Nano needed).
- `react-native-gemini-nano` (+ config plugin) — Gemini Nano via AICore for
  the Android concierge (Pixel 8+ hardware only).

**Deliberately NOT pre-linked:**
- Live Activity widget (iOS) — a Swift widget extension is a separate build
  target whose UI can't be OTA'd anyway; add it when the feature is built.
- ReplayKit broadcast extension (iOS screen share) — same reason; web/PWA
  screen share needs nothing.

**Coming-soon switches.** Settings → Experimental shows a row for each major
upcoming feature **before it exists**: visible but disabled, marked "Coming
soon"; when a feature ships via OTA the row becomes a live toggle. Everything
that used this pattern has since shipped (Chat — since graduated out of
Experimental entirely, Calls, Zaps, Wallet, Mini-apps); `ComingSoonRow` in
`ExperimentalSection.tsx` stays for the next batch. Keep this list in sync
with the sections below.

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

### Safety kit — partly shipped
- **Done**: an Emergency Call button (quick-dial the local police number for the
  pickup area) shows for the passenger/customer while a deal is In Transit; live
  live-location sharing during an active deal also ships.
- **Remaining**: auto-share the live trip to pre-chosen *trusted contacts* (not
  just the counterparty), and a route-deviation alert that compares live
  position against the expected route client-side and nudges the rider
  ("off route — everything OK?") with one-tap SOS.

### Fair-price discovery — "going rate" widget — small, pure client-side
- Intents (and confirmed deals, via receipts) are already public signed events,
  so a client can compute local market stats with no server and no protocol
  change: median/range of accepted prices for a similar corridor + time window.
- Surface it in two places: while **composing** an intent ("similar rides
  settled at $10–13 this week") and while **countering** ("this ask is ~20%
  above the going rate"). Directly improves negotiation quality for newcomers
  who have no feel for local prices.
- Mechanics: reuse the browse subscription's event stream; bucket by market +
  geohash-prefix pair (from→to) + day-part; take price from confirmed-deal
  receipts where present, falling back to posted asks. All local, nothing new
  is published.
- Honest caveat: quality scales with liquidity — hide the widget below a
  minimum sample size rather than show a misleading number.

### Hourly charter / rental — small
- Intent type with per-hour pricing terms (car + driver for N hours). Template
  + UI only; negotiation flow unchanged.

### Non-goals (need a central operator)
CUSTODIAL wallets/escrow (the self-custodial wallet has shipped — Breez Spark +
NWC, `src/wallet/`; custody/escrow stays off-limits), surge pricing (Freeport is
free negotiation), loyalty programs, trip insurance, centralized driver vetting.

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

## Follow-ups on shipped features

Chat, calls (+ web screen share), NIP-17 gift wrap for chat/calls, zaps,
NIP-15 storefronts, the on-device AI concierge and in-chat auto-translate all
SHIPPED in 2026-07 (see git history for the full specs). What remains of each:

- **Chat**: GRADUATED from Experimental (2026-07-14) — always on, the
  Settings toggle is gone. Remaining: verify safety number (fingerprint
  compare), note-to-self, polish (per-chat mute, pin/forward a message,
  share a friend's invite). Group chat stays deferred (MLS/NIP-104
  immature). In-conversation search shipped.
- **NIP-17**: migrate the NEGOTIATION envelopes (big NIP-04 install base) —
  dual-rail: receive first, send behind a capability flag, then default.
- **Calls**: native screen share (ReplayKit / MediaProjection), CallKit /
  ConnectionService ringing UI, deploy `infra/turn-credentials` (needs a
  Cloudflare Realtime TURN key — user action). Group calls need an SFU:
  non-goal.
- **Zaps**: zap from profiles/chat; zap totals as a reputation input.
- **Storefronts**: NIP-15 stalls (30017), quantities/sold-out, shop
  search/categories, per-shop zap totals.
- **AI (concierge + translate)**: agent loop driven by language (watch
  offers, negotiation assistance), deterministic template-parser tier for
  devices without any model; mobile-web providers appear automatically when
  Chrome Android / Safari ship the built-in AI APIs.

## Mini-apps — a decentralized super-app shell (NIP-07 + WebLN)

**Status (2026-07): v1 SHIPPED (experimental toggle, native-only).** The
architecture is policy/mechanism-split: `miniapps/firewall.ts` is the single
choke point every bridge RPC passes through (per-origin permission table,
sensitive-kind always-ask list, per-app + global daily spend caps, payment
cooldown, sign/invoice rate limits, ask-flood cap, audit log) — pure TS with
its own adversarial suite; `bridge.ts` translates shim RPCs into firewall
facts (payment amounts parsed from the invoice native-side, never
app-claimed; sign templates field-whitelisted) and `MiniAppShell.tsx` is the
hardened WebView (static shim, main-frame-only, incognito per app, navigation
locked to the registered origin, popups off, responses escape-encoded).
Add by URL or QR under Settings → Mini-apps; punycode lookalike origins are
refused outright. **Web mode also shipped**: a sandboxed cross-origin iframe +
`MessageChannel` handshake (port handed over with targetOrigin pinned to the
registered origin — browser-authenticated, stronger than native's navigation
tracking) with a one-line postMessage SDK (`packages/miniapp-sdk`, served at
freeport.network/sdk.js) that is deliberately outside the TCB; approval
dialogs render in the parent DOM with delayed-arm Allow buttons. Same
firewall, same tests. Demo: examples/demo-app → freeport.network/demo-app.
Remaining: a Nostr-published directory/blocklist, per-app spend-cap UI.

The idea: Freeport as an **identity + wallet provider for web apps** — the
WeChat/Zalo mini-program concept done the Nostr way (no curated store, no
operator; apps are added by URL/QR). Standard surfaces: NIP-07
(`window.nostr`), WebLN (`window.webln`), plus `window.freeport` extensions —
`paySpark` (Spark/stablecoin payments) and the private reads `getBalance` /
`getLocation` (public data like reputation is intentionally not bridged — the
app derives it from the npub). Two worked examples: `examples/demo-app` (eSIM
shop) and `examples/insurance-store` (npub-derived underwriting + PDF cert). The full permission model (kind
allowlist, default-deny decrypt, spend caps, per-payment approval) lives in
`apps/mobile/src/miniapps/firewall.ts` and its adversarial test suite —
that code is the spec now. Architecture & threat model:
[`docs/miniapps-security.md`](miniapps-security.md); integrator docs:
`packages/miniapp-sdk/README.md`.

**Remaining:**
- Nostr-published app directory + community blocklist (addressable events;
  the firewall already takes an injectable blocklist).
- Per-app spend-cap UI (the firewall enforces caps; Settings has no editor yet).
- Approval-dialog niceties: translate the sensitive-kind warning per kind,
  show fiat next to sats.

## Conditional payments — HODL invoices (trust-minimized escrow)

**Status (2026-07): v1 SHIPPED.** (An earlier note here claimed the SDK lacked
the API — wrong: it's named `claimHtlcPayment` + `bolt11Invoice.paymentHash`,
present in BOTH builds since 0.18/0.19, so it even ships to current binaries
via OTA.) The buyer holds the preimage; the seller can only settle when the
buyer releases it on delivery — the Lightning protocol enforces the lock, no
custodian ever touches the money:

- `escrow.request/invoice/release` envelope family over the encrypted DM
  channel, deal-scoped, replay-safe, preimage verified against the hash
  before the wallet is ever touched
- buyer: "Pay with escrow" on a confirmed deal → amount in sats → pays the
  seller's hold invoice → "Release escrow" on delivery (confirm-guarded);
  unreleased funds auto-refund after 24h (invoice expiry)
- seller: "Create hold invoice" card → auto-claim on release; claim_failed
  keeps a Retry button (e.g. buyer hadn't funded yet)
- preimage persisted on the buyer device (losing it = wait for the refund)

Remaining: fiat→sats prefill for the amount, funded-state detection on the
seller side (SdkEvent.PaymentPending), surface the escrow state in the deal
receipt/karma flow.

