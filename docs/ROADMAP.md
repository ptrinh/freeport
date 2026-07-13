# Freeport — Roadmap / Deferred work

Items intentionally postponed, with enough context to pick them up later.

## Ship-ahead policy: native modules + coming-soon switches

Binary releases are slow (store review) but OTA JS updates are instant — so
every binary ships **ahead of the roadmap**: native modules for planned
features are linked now, and the features arrive later as pure-JS OTA pushes.
`runtimeVersion.policy = appVersion` keeps this safe: bump the app version
whenever a native module is added, and OTA updates for the new runtime never
reach old binaries that lack the module.

**Pre-linked as of 1.6.0** (feature JS not yet shipped):
- `react-native-webrtc` (+ config plugin) — for audio/video calls + screen
  share. Mic/camera permissions were already in the manifest (voice messages,
  QR scan).
- `react-native-webview` — for the mini-apps shell (and any embedded web flow).

**Deliberately NOT pre-linked:**
- Live Activity widget (iOS) — a Swift widget extension is a separate build
  target whose UI can't be OTA'd anyway; add it when the feature is built.
- ReplayKit broadcast extension (iOS screen share) — same reason; web/PWA
  screen share needs nothing.

**Coming-soon switches.** Settings → Experimental shows a row for each major
upcoming feature (Chat, Calls, Mini-apps, Zaps) **before it exists**: visible
but disabled, marked "Coming soon". Users see what's next; when a feature
ships via OTA, the row becomes a live toggle (the pref pattern is already
established — the Wallet toggle landed ahead of the wallet). Keep this list in
sync with the sections below.

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

### In-chat auto-translate — medium, privacy-sensitive
- 56 UI locales already exist; translating chat between two people needs a
  translation engine. On-device model preferred; a cloud API must be explicit
  opt-in per chat (it leaks message content to a third party — surface that).

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

## NIP-17/NIP-44 gift-wrapped DMs — metadata privacy upgrade

NIP-04 encrypts message *content*, but relays still see **who talks to whom and
when** — every negotiation leaks its social graph as public metadata (sender
pubkey, recipient `p` tag, timestamp). For a marketplace, that's a map of who
is dealing with whom. NIP-17 fixes it:

- **NIP-44** replaces NIP-04's encryption (modern construction:
  secp256k1 ECDH → ChaCha20 + HMAC-SHA256, versioned, padded).
- **NIP-17 gift wrap**: the real message (kind 14, unsigned "rumor") is
  **sealed** (kind 13, signed by the sender, encrypted to the recipient) and
  then **wrapped** (kind 1059) with a **throwaway key** and a **randomized
  timestamp**. On the wire, a relay sees only: random-pubkey → recipient,
  at a fuzzed time. Sender identity, message kind, and timing are hidden;
  deniability comes free (the inner rumor is unsigned).

**Scope.** This upgrades every DM path at once: negotiation envelopes, chat
(friend chat rides on the same transport), call signaling, and the chat-invite
handshake. Nothing about the public intent events changes — those are public
by design.

**Migration (the real work).** Old clients speak NIP-04 only, so cut over
gradually:
1. Ship **receive** support first (subscribe to kind 1059 for our pubkey,
   unwrap → route into the same negotiation/conversation stores). OTA-able.
2. Then **send** NIP-17 when the peer advertises support — via a capability
   flag in the negotiation envelope or a kind-10050 (DM relay list) probe —
   falling back to NIP-04 otherwise.
3. After the fallback window (track adoption via the flag), default to
   NIP-17-only and keep NIP-04 receive for stragglers.

**Caveats.** Wrapped events are bigger (double encryption + padding); some
relays rate-limit kind 1059 or drop unsigned-inner constructions — verify the
default relay set handles them. Subscription model changes too: you can no
longer filter inbound DMs by sender (that's the point), so dedupe/routing keys
off the unwrapped rumor instead.

**Effort:** medium — nostr-tools already ships nip44 + gift-wrap helpers; the
bulk is the dual-rail migration and testing across old↔new client pairs
(extend the fake-relay multi-client tests in `apps/mobile/test/`).

## Peer-to-peer chat (friend chat) — experimental

**Status (2026-07): v1 core SHIPPED** — experimental toggle, hash-commitment
invite codes (publish/resolve/rotate over relays), `chat.*` envelope family
parsed ahead of the negotiation path, conversation store with replay guards,
FAB + invite QR/link popup, `#invite=` link handling (web hash + native deep
link), accept/reject handshake, WhatsApp-style rows, archive + block,
delivery/read receipts + last-seen-via-acks with reciprocal Settings → Chat
toggles. Still open from the spec below: transport is NIP-04 behind the
send/watch seam (NIP-17 swap pending), and the `[v1]`-extras/`[later]` feature
list (in-chat payments, reply, reactions, disappearing, verify safety number,
note-to-self, polish).

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

**Sequencing with NIP-17 (see the gift-wrap section above).** NIP-04 leaks the
friend graph to relays (who ⇄ whom, when) — worse for social chat than for deal
DMs. Chat has no install base yet, so it should launch **NIP-17-native** (or at
minimum behind the same transport abstraction the NIP-17 migration introduces)
rather than shipping on NIP-04 and migrating later. If chat lands first, build
it on a `sendPrivate/watchPrivate` seam so swapping the wire format is a
transport change, not a chat change.

**Message envelope (new types, parsed before the negotiation path).**
`watchDMs` currently decrypts and runs `parseNegotiationMessage`, which accepts
only negotiation types (they require `nego` + `intent_id`) and silently drops
everything else. Friend chat adds its own envelope family, versioned like the
negotiation one: `chat.invite`, `chat.accept`, `chat.reject`, `chat.msg`,
`chat.ack` (delivery/read receipts, doubling as the presence carrier — below).
Parse these in a branch BEFORE the negotiation path so they never fall into the
`pendingMsgs` queue waiting for an intent that doesn't exist. Old clients drop
unknown types on the floor — that's the (graceful) compat story.

**Invite = relay-resolved short code (Option 2, no hosted server).**
- **The code is a hash commitment to the inviter's pubkey** — NOT a random
  string. d-tags are only unique per *(kind, pubkey, d)*, so with a random code
  anyone watching relays could race-publish the same `d` under their own pubkey
  and hijack the invite (the victim would chat with — and could in-chat-pay —
  the attacker). Instead: mint a random nonce, set
  `code = base32(sha256(inviter_pubkey ‖ nonce))[:10]`, and publish the
  addressable event with `d = <code>` carrying the nonce + a display name,
  signed by the inviter. The resolver recomputes the hash from each candidate
  event's author + nonce and **discards any event whose author doesn't match
  the code** — forgeries are unresolvable by construction. Link stays short,
  no directory needed. Reserve the event kind in `packages/protocol/src/constants.ts`
  and spec it in `docs/protocol.md` alongside the intent kinds.
- Short TTL; revocable by republishing the same `d` empty (same mechanism as
  intent withdraw). Reuses the addressable d-tag machinery already in `client.ts`.
- Sharing: QR code + a fragment link `https://freeport.network/#invite=<code>`.
  The `#fragment` is client-side only (never sent to a server), same as the
  live-trip `#t=` links the app already parses.
- Resolving: opening the link → app queries relays `{ '#d': [code], kinds: [<invite kind>] }`
  → verifies the commitment (above) → gets the inviter's pubkey. Relays do the
  lookup; no shortener service.
- Entropy note: 10 base32 chars (~50 bits) keeps casual enumeration/collision
  low; a guessed code only leaks "you may receive a chat invite", never funds
  or keys.
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
- **Show last seen** — share your last-online time so contacts see it on the
  chat. Off = you don't share it (and, reciprocally, you don't see theirs).
  Mechanism: **piggybacked on the encrypted `chat.ack` receipts** (a `last_seen`
  timestamp on each ack). A public addressable presence event can't be
  "readable only by contacts" — there's no group-encryption primitive here —
  so the choice is leak-to-everyone or O(N) per-contact DMs; the ack channel
  already flows exactly to accepted contacts and costs nothing extra. Trade-off
  (accepted): last-seen only refreshes per active conversation, not globally.
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

**Screen sharing.** During a call, share your screen — it's just another
media track on the SAME WebRTC connection (no new infra, same e2e).
- Web/PWA: `navigator.mediaDevices.getDisplayMedia()` → replace/add the video
  track. Easy.
- Native: heavier — iOS needs a **ReplayKit Broadcast Upload Extension** (a
  separate build target); Android uses the **MediaProjection** API.
  `react-native-webrtc` supports both but each needs native config. Ship it
  web-first, native later.
- Warn before starting: a shared screen can leak notifications, other chats,
  or sensitive info beyond what you intend.

**Scope.** 1:1 only — mesh WebRTC doesn't scale past ~4 and group calls need an
SFU (an operator media server). Native needs `react-native-webrtc` (a heavy
native module → a fresh binary build + mic/cam permissions, which the app
already requests). Web/PWA can ship first.

**Effort:** medium-high — WebRTC integration + native module, call UI
(incoming/outgoing/in-call), signaling over DMs (small, reuses chat), and the
TURN-credential Worker.
