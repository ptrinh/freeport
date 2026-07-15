# Freeport — Roadmap / Deferred work

Items intentionally postponed, with enough context to pick them up later.
Shipped features live in the README and git history, not here — each section
below is only what REMAINS.

## Ship-ahead policy: native modules + coming-soon switches

Binary releases are slow (store review) but OTA JS updates are instant — so
every binary ships **ahead of the roadmap**: native modules for planned
features are linked now, and the features arrive later as pure-JS OTA pushes.
`runtimeVersion.policy = appVersion` keeps this safe: bump the app version
whenever a native module is added, and OTA updates for the new runtime never
reach old binaries that lack the module.

**Deliberately NOT pre-linked** (a Swift/Kotlin build-target extension can't
be OTA'd anyway; add these when the feature is built):
- Live Activity widget (iOS)
- ReplayKit broadcast extension (iOS screen share) — web/PWA screen share
  needs nothing.

**Coming-soon switches.** Settings → Experimental shows a row for each major
upcoming feature **before it exists**: visible but disabled, marked "Coming
soon"; when a feature ships via OTA the row becomes a live toggle.
`ComingSoonRow` in `ExperimentalSection.tsx` stays for the next batch.

## Feed image performance — `expo-image` (JS switch pending)

**Status (2026-07): native module PRE-LINKED in 1.6.1** (`expo-image@~3.0.11`,
SDK-54 line, `expo install --check` clean). Per the ship-ahead policy the pod
ships in the 1.6.1 binary; the pure-JS switch lands later via OTA to the 1.6.1
runtime.

**Remaining (pure JS):** replace `react-native` `<Image>` in the feed / avatars
/ chat thumbnails (`BrowseTab.tsx`, `MessagesTab.tsx`, chat) with `expo-image`
for disk caching, `contentFit`, and `recyclingKey` — user-uploaded originals
currently decode at full size inside virtualized lists (memory spikes + scroll
hitching on image-heavy feeds; no cache policy on web). Guard the import so
older runtimes (≤1.6.0, no pod) fall back to `<Image>` — the same
`requireOptionalNativeModule` pattern as `cameraModule.ts`/`passkey.ts`.

## Lock-screen live progress (Live Activity)

**Goal:** show deal/trip progress on the phone lock screen + Dynamic Island,
driven by the existing fulfillment stages (Confirmed → Picked up → Completed).
Native EAS builds exist (App Store + Play), so what remains:

1. **Android first** (cheaper, proves the concept): foreground service +
   ongoing notification with a progress bar (Notifee or expo-notifications).
2. **iOS:** ActivityKit Live Activity = a small Swift widget extension
   (`expo-live-activity` / `react-native-live-activity` to start/update from
   JS). iOS 16.1+.
3. Wire the fulfillment stage transitions (DealsTab `setStageFor`) to
   start/update/end the activity.

**Key constraint — no backend:** remote Live Activity updates need a push
server; without one, updates are **local only** (while the app is
running/backgrounded). Acceptable v1. Web never gets this (no browser API).

## Community broadcast channel (admin → members, 1-to-many)

**Context:** the Communities feature (group invite links, shared market, trust
seeding) shipped. The natural next step for member communication is a
**one-to-many broadcast/announce channel**, NOT full many-to-many group chat.
Full group chat fights the architecture: NIP-29 relay-managed groups
reintroduce a managed relay (= an operator, against the "dumb relays, no
operator" thesis), and fan-out gift wraps cost N encryptions per message with
no membership-consistency or ordering guarantee — and would multiply the
kind-1059 volume the notify server now watches. Group chat stays deferred
(MLS/NIP-104 still immature); revisit only if real usage demands back-and-forth.

**Sketch (operator-free, low complexity):**
- Admin publishes to an **addressable kind** keyed on the group id (reuse the
  admin-signed group descriptor from `packages/protocol/src/group.ts`); members
  who joined via the invite subscribe to it (they already hold the descriptor).
- One-way: only the group admin(s) post; members read. No fan-out — a single
  event per announcement, encrypted to the group if the market is private or
  left public for open markets.
- Notifications reuse the existing content-blind push path (a new watched kind),
  same as the kind-4/1059 friend-chat fix.
- Membership/leave handling is soft (unsubscribe locally); no key rotation
  needed because it's broadcast, not a shared secret conversation.

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

### Safety kit — remaining pieces
(The Emergency Call button and live-location sharing during a deal shipped.)
- Auto-share the live trip to pre-chosen *trusted contacts* (not just the
  counterparty).
- Route-deviation alert: compare live position against the expected route
  client-side, nudge the rider ("off route — everything OK?") with one-tap SOS.

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
Custodial wallets/escrow (self-custodial wallet + HODL-invoice escrow shipped;
custody stays off-limits), surge pricing (Freeport is free negotiation),
loyalty programs, trip insurance, centralized driver vetting.

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
   export per runtime, sign, upload to R2, purge cache. Keep channels
   (production/preview) as URL paths.
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

Chat, calls, NIP-17 gift wrap for chat/calls, zaps, NIP-15 storefronts, the
on-device AI concierge, in-chat auto-translate, the self-custodial wallet,
HODL-invoice escrow, mini-apps (native WebView + web iframe shells, Apps-tab
launcher, SDK) and the Telegram bridge are all SHIPPED — see the README and
git history. What remains of each:

- **Chat**: verify safety number (fingerprint compare), note-to-self, polish
  (per-chat mute, pin/forward a message, share a friend's invite). Group chat
  stays deferred (MLS/NIP-104 immature).
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
- **Escrow (HODL invoices)**: fiat→sats prefill for the amount, funded-state
  detection on the seller side (SdkEvent.PaymentPending), surface the escrow
  state in the deal receipt/karma flow.
- **Mini-apps**: Nostr-published app directory + community blocklist
  (addressable events; the firewall already takes an injectable blocklist);
  per-app spend-cap UI (the firewall enforces caps; no Settings editor yet);
  approval-dialog niceties (per-kind sensitive warning copy, fiat next to
  sats). Architecture & threat model:
  [`docs/miniapps-security.md`](miniapps-security.md); integrator docs:
  `packages/miniapp-sdk/README.md` — that code is the spec.
- **Live Activity**: see the lock-screen section above.
