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

## Peer-to-peer chat (friend chat) — experimental

Direct 1:1 chat between users, independent of any deal — reusing the encrypted
DM transport and chat UI the marketplace already has. Gated behind an
**Experimental → Chat** switch (a new `experimentalChat` pref, same pattern as
`experimentalWallet`); everything below only exists when it's on.

**Identity & transport (no new dependency).** Chat is pubkey-to-pubkey over the
existing NIP-04 encrypted DMs (`client.sendChat`/`watchDMs`, keyed on pubkey).
It deliberately does NOT use the lightning address / NIP-05 — so it adds no
username→pubkey directory and never links the payment handle to the Nostr
identity (see the privacy note under the wallet section). The only thing shared
out-of-band is an invite.

**Invite = relay-resolved short code (Option 2, no hosted server).**
- Generating: the app mints a random 8–10 char code and publishes a small
  **addressable event** with `d = <code>`, signed (author = the inviter's
  pubkey), carrying a display name. Short TTL; revocable by republishing the
  same `d` empty (same mechanism as intent withdraw). Reuses the addressable
  d-tag machinery already in `client.ts`.
- Sharing: QR code + a fragment link `https://freeport.network/#invite=<code>`.
  The `#fragment` is client-side only (never sent to a server), same as the
  live-trip `#t=` links the app already parses.
- Resolving: opening the link → app queries relays `{ '#d': [code], kinds: […] }`
  → gets the inviter's pubkey. Relays do the lookup; no shortener service.
- Entropy note: 8–10 chars keeps casual enumeration/collision low; a guessed
  code only leaks "you may receive a chat invite", never funds or keys.
- **Rotating**: the invite popup has a **Generate new invite link** button —
  it tombstones the current code (republish its `d` empty, so the old
  QR/link stops resolving) and mints+publishes a fresh one. Use it if a link
  leaked or got shared too widely. One active invite code per user at a time.

**Opening the link.**
- Web: the web app reads `location.hash`, resolves the code, shows the invite.
- Mobile browser with the app installed: offer **"Open with Freeport app"** via
  a universal link / deeplink carrying the code, so the native app handles it.
- Fallback: the web app handles it in-page.

**Handshake (accept/reject).**
1. The opener sees the resolved invite and taps **Send Chat Invite** → sends a
   chat-invite DM to the inviter's pubkey.
2. The inviter receives an incoming request and can **Accept / Reject**.
3. On Accept the conversation goes active and both sides can chat; on Reject it
   is dropped. Until accepted, it's a pending request (spam gate for unknown
   pubkeys).

**Messages tab UI.**
- A circular **floating action button** (`+` icon) pinned bottom-right, sitting
  **above** the bottom tab bar (never overlapping it). Only shown when Chat is
  on. Tapping opens the invite popup (QR + shareable link + copy).
- Friend chats appear as rows, WhatsApp-style: a round **profile picture on
  the left**, then `[Name]` / `[Last message]` / `[Time]` — in the Messages
  list (a section distinct from deal threads). The avatar is the peer's kind:0
  `picture` (profiles are already fetched via `onProfileFetched`), falling back
  to the same dicebear-by-npub avatar the app uses elsewhere.
- Tapping a row opens the **same chat UI as the deal chat** (`ChatThread`),
  with a top action to **Archive** the conversation and a **Block** action.

**Refactor required.** `ChatThread` is currently bound to a `Negotiation`
(`nego.messages`). Extract a generic **Conversation** model keyed by peer pubkey
(pending | active | archived | blocked, message list, last-message/time) and a
small conversations store; point both the deal chat and friend chat at it.
`watchDMs` already delivers inbound DMs by pubkey, so routing a DM to a
conversation (vs a negotiation) is the main wiring.

**Safety.** Invites are opt-in (you choose who gets the code); accept/reject
gates DMs from unknown pubkeys; per-conversation block + archive; invite codes
expire. No content is ever public — only the ephemeral, randomly-keyed invite
event exists on relays, and only until it expires or is revoked.

**Chat settings — a dedicated Settings → Chat section.** The experimental
on/off switch stays under Features; once Chat is enabled a separate **Chat**
section appears in Settings (its own collapsible, like Browse/Features)
holding these two toggles:
- **Show last seen** — publish your last-online time so contacts see it on the
  chat. Off = you don't broadcast it (and, reciprocally, you don't see theirs).
  Mechanism: a presence marker refreshed on app foreground (an addressable
  `d`-tagged event, or piggybacked on the read-marker below), readable only by
  accepted contacts.
- **Chat receipts** — WhatsApp-style delivery/read ticks:
  - **1 grey tick** = sent (event accepted by a relay),
  - **2 ticks** = delivered (recipient's client received + decrypted it),
  - **2 green ticks** = read (recipient opened the conversation).
  Delivered/read require the recipient to send back a tiny ack DM (or an
  addressable "read up to <ts>" marker). Off = you send no acks and,
  reciprocally, don't see others' ticks.
- **Enable calls** — turn on 1:1 audio/video calls (see the calls section). Off
  = no call button, and incoming call invites are declined automatically.
  Show a note under the toggle: **"Your IP address may be exposed to the person
  you call."** (WebRTC reveals your IP to the peer on a direct connection;
  turning on TURN fallback below relays instead so the peer can't see it.)
  When on, a nested sub-toggle appears:
  - **Enable TURN fallback for calls** — when a direct peer-to-peer connection
    fails (~15–20% of calls behind strict NAT), relay the call through TURN
    (Cloudflare) so it still connects — and, as a side effect, the two peers no
    longer see each other's raw IP (Cloudflare does; media stays e2e). Off =
    direct-only: better IP privacy vs. the relay, but those calls just fail.

All toggles default OFF (privacy-first, consistent with the rest of Freeport).

**Chat feature set (Telegram/WhatsApp parity, filtered to what fits P2P).**
Ordered by value-for-effort; `[v1]` ship with the first cut, `[later]` follow-ups.

1. **In-chat payments** `[v1]` — the standout combo: you already know the peer's
   pubkey and (via Contacts / their invite) a pay address, and the wallet
   exists. A **Send** action in the chat opens the wallet Send flow prefilled
   for this peer (sats / USDT). Nothing Telegram/WhatsApp do self-custodially.
2. **Reply / quote** `[v1]` — a reply-to reference in the message payload,
   rendered as a quoted snippet above the bubble.
3. **Reactions (emoji)** `[v1]` — NIP-25-style reactions, but encrypted like the
   DMs (an ack-style message carrying the target id + emoji).
4. **Disappearing messages (TTL)** `[v1]` — per-conversation timer; messages
   auto-delete locally after the timer. Client-side expiry is exact on your
   device; the peer's deletion is a request (best-effort, like any e2e app).
   Strong fit for the privacy ethos.
5. **Verify safety number** `[later]` — a Signal-style screen to compare pubkey
   fingerprints (or scan each other's) and mark a contact verified. Leans into
   "own your identity"; small.
6. **Note-to-self (Saved messages)** `[later]` — a conversation with your own
   pubkey for quick notes; nearly free once the Conversation model exists.
7. **Polish** `[later]` — per-chat mute, in-history search (over decrypted
   messages, local), pin a message, forward a message, and share a friend's
   invite. All small, independent additions.

Deliberately deferred / out of scope: **group chat** (encrypted groups over
Nostr are an unsolved-ish problem — MLS/NIP-104 is still maturing; big lift),
**edit/unsend** (Nostr NIP-09 deletion is best-effort — peers may have cached),
and sticker/GIF stores + large media CDNs (hosting cost, not core).

**Effort:** medium for the v1 cut. Transport + `ChatThread` reuse is small; the
Conversation model/store, the invite publish+resolve flow, the deeplink
handling, the FAB + accept/reject UX, the last-seen/receipts acks, and the
`[v1]` features (in-chat pay, reply, reactions, disappearing) are the bulk.

## Mini-apps — a decentralized super-app shell (NIP-07 + WebLN)

Turn Freeport into a host that injects its **portable identity** and
**self-custodial wallet** into third-party web apps — the WeChat/Zalo
mini-program idea, done the Nostr way (no curated store, no operator).

**How.** A WebView shell exposes the two standard bridges so any web app "just
works" against a Freeport user:
- **NIP-07** (`window.nostr`: `getPublicKey`, `signEvent`, `nip04`/`nip44`) —
  "sign in with your Freeport key". Portable, self-sovereign identity — better
  than WeChat's siloed account.
- **WebLN** (`window.webln`: `makeInvoice`, `sendPayment`) — the WeChat-Pay
  analog, but self-custodial via the built-in wallet.
Distribution is **decentralized**: apps are launched by URL / QR or listed in a
Nostr-published directory (addressable events) — not a central app store.

**Security is the hard part (non-negotiable).** A malicious mini-app must never
exfiltrate the nsec or drain the wallet:
- The raw key is never exposed; signing happens in the shell.
- Every `signEvent` / `sendPayment` is gated behind an explicit approval dialog
  (MetaMask/Alby-style), with per-app permissions and a spend cap.
- Ties directly to the on-device / passkey key handling — get that right first.

**Caveats.** App Store/Play are hostile to "run downloaded third-party code /
mini-app store" (Apple 4.7 allows it only within limits) — so this is
**web/PWA-first**; a native version is constrained/later. Decentralized launch
(URL / Nostr directory) fits the ethos; a curated store does not.

**Framing:** "Freeport as an identity + wallet provider for web apps", not "an
app store". **Effort:** medium-high, security-dominated.

## Conditional payments — HODL invoices (trust-minimized escrow)

The honest answer to "no one will protect you here": escrow-like safety with no
custodian. The buyer pays a **hold invoice** whose funds are locked, not
settled, until the buyer releases on delivery — otherwise it expires and
refunds automatically. No operator ever holds the money; the Lightning protocol
enforces it. Highest-value trust primitive for a marketplace where deals can go
bad. **Caveat:** depends on hold-invoice support in the Breez SDK / Spark L2 —
verify before committing; may need a fallback rail. Pairs naturally with deal
receipts and the `payment` flow that already exists.

## Zaps / tipping (NIP-57)

Tip sats to a good post, a helpful reply, or a trusted seller — the Nostr-native
social-payment primitive, layered on the wallet + karma that already exist.
Low effort, high virality: a zap button on posts / profiles / chat, a running
zap total as a soft reputation signal alongside karma. Uses the lightning
address for the zap request; publish zap receipts (kind 9735) so totals are
verifiable.

## AI concierge

Freeport already ships personal agents (`packages/agent`). Surface one in the
app as a natural-language concierge: "find me a ride to the airport at 5pm under
$12" → it drafts the intent, posts it, watches for counter-offers, and surfaces
the best matches for the human to confirm — the existing negotiate loop, driven
by language instead of forms. On-brand for a project built with Claude Code.
On-device or bring-your-own-model to keep it operator-free; a hosted model must
be explicit opt-in (it sees your request text).

## Persistent storefronts (NIP-15)

Today providers post one-off intents. A standing **shop** — a seller's catalog
as addressable events (NIP-15 Nostr Market: stalls + products) — lets them list
durable offerings that stay browsable, not just a single request that expires.
Turns Freeport from a ride/task board into a general P2P marketplace, reusing
the same signed-events + reputation + wallet stack. Buyers browse a shop, start
a negotiation/chat, pay with the wallet. Mostly additive: a new event
kind/template + a shop view + a "my shop" editor.

## Audio/video calls (WebRTC + Nostr-DM signaling)

1:1 voice/video in chat — reusing the encrypted DM channel for the one piece
that normally needs a server.

**How.**
- **Media**: WebRTC (`react-native-webrtc` on native, built-in on web/PWA),
  **e2e encrypted by default** (DTLS-SRTP) directly between the two peers.
- **Signaling** (SDP offer/answer + ICE exchange): sent as a few encrypted
  NIP-04 DM events — **no signaling server**, reuses the chat transport. Media
  never touches a relay.

**NAT traversal — the only server-ish piece.** WebRTC needs STUN + sometimes
TURN:
- **STUN** (public IP discovery): free public servers, stateless — no burden.
- **TURN** (relays media when a direct connection fails, ~15–20% of calls):
  relays real bandwidth → needs infra. Recommended setup:
  **STUN-first for the ~80% direct case + Cloudflare Realtime TURN as fallback.**
  Cloudflare runs the TURN; a small Worker (same pattern as `lnurlp-proxy`)
  mints **ephemeral** TURN credentials from a server-side API token (never
  shipped to the client) and returns `iceServers` to the app. Billed on relayed
  egress with a generous free allowance (verify current pricing); since TURN
  only handles the fallback slice, real cost is small. Alternatives for
  forks/self-host: their own Cloudflare token, self-hosted `coturn`, or
  Metered's free tier. Or degrade gracefully (no TURN → call fails when direct
  fails).

**Privacy caveat (surface to the user).** WebRTC leaks your IP to the peer (or
to TURN). For a pubkey-pseudonymous marketplace that's a deanonymization
vector. Offer a **force-relay-through-TURN** option: the two peers no longer see
each other's raw IP (Cloudflare does, but media stays e2e). Warn before the
first call.

**Scope.** 1:1 only — mesh WebRTC doesn't scale past ~4 and group calls need an
SFU (an operator media server). Native needs `react-native-webrtc` (a heavy
native module → a fresh binary build + mic/cam permissions, which the app
already requests). Web/PWA can ship first.

**Effort:** medium-high — WebRTC integration + native module, call UI
(incoming/outgoing/in-call), signaling over DMs (small, reuses chat), and the
TURN-credential Worker.
