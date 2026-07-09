# Multi-party testing (driver ⇄ passenger) in one browser

Freeport has **per-profile storage isolation** so you can run several independent
identities side-by-side on one machine and have them negotiate real deals over
the live Nostr relays — no second device needed.

## How it works
`src/kv.web.ts` namespaces **every** localStorage key by a `?profile=N` (or
`#profile=N`) URL param. Each profile = its own Nostr key, profile, prefs and
saved negotiations. `src/debug.web.ts` exposes a `window.freeport` console API
and sets the tab title to `Freeport · P<N>` so tabs are easy to tell apart.

Open each party in its own tab:
```
https://freeport.network/?profile=1     ← e.g. Passenger A
https://freeport.network/?profile=2     ← Passenger B
https://freeport.network/?profile=3     ← Driver A
https://freeport.network/?profile=4     ← Driver B
```
All tabs share one Chrome profile/extension — the isolation is the `?profile`
namespace, NOT separate Chrome profiles. (Native apps ignore `?profile`; this is
a web-only test aid.)

## Console helpers (`window.freeport`)
```
freeport.help()            list everything
freeport.state()           { profile, npub, relays, intentsInFeed, negotiations, storedKeys }
freeport.dump()            all stored values for this profile (parsed)
freeport.negotiations()    live deals from the client
freeport.intents()         intents currently in the feed
freeport.profile           active profile id
freeport.switchTo(2)       reload THIS tab as ?profile=2
freeport.open(2)           open ?profile=2 in a NEW tab (the counterparty)
freeport.reset()           wipe THIS profile's storage and reload
freeport.client            the live MobileClient (advanced)
```
`freeport.state()` / `freeport.negotiations()` are the fastest way to assert
outcomes without scraping the DOM — read them via the page console / JS eval in
each tab instead of clicking through screens.

## Onboarding a party (per tab)
1. **Create new account** → pick role (Passenger / Driver) → fill Display name +
   Phone (e.g. SG `91234567`) → **Continue**.
2. Location: allow, or it falls back to coarse IP. Passengers post a request
   (From = pin/typed, To, time, amount); Drivers **Browse** → **Counter**/respond.

## Claude-in-Chrome recipe
- `tabs_create_mcp` ×4, `navigate` each to `?profile=1..4`, confirm titles
  `Freeport · P1..P4`.
- Drive each tab by its `tabId`. Prefer `find` / `read_page` to locate elements
  and `browser_batch` to chain clicks; assert via `freeport.state()` /
  `freeport.negotiations()` in each tab rather than eyeballing screenshots.
- Relays propagate between tabs in ~1–3s — add a short wait before asserting the
  counterparty has received an intent/DM.

## Test cases worth running (driver/passenger)
Highest-value (where bugs have been found) = cancel/withdraw propagation, accept
races, offline-peer, addressable-replacement, NIP-40 expiry:
- 2 drivers each offer/counter on 2 passengers' requests (fan-out); each passenger
  sees both drivers; accepting one auto-cancels the losing bid.
- Passenger cancels after a counter → counter clears on passenger Active **and**
  driver gets MSG_CANCEL; listing drops from Browse on both.
- Cancel after **confirmed** → uses mutual-cancel flow, not silent kill.
- Simultaneous Accept on both sides → one confirmed deal, no double-book.
- Expiry: pickup time / NIP-40 passes mid-negotiation.
- Completed or cancelled deal disappears from Browse.
- Counter changes only time/price — route (From/To) stays the original.
- Reconnect: `freeport.reset()` is destructive; to test reload just refresh the
  tab and confirm state rebuilds from relays + local store.

## Findings — 2026-06-17 test run (2 drivers × 2 passengers)

Setup: P1/P2 = Passengers A/B, P3/P4 = Drivers A/B (all VN/Quảng Ninh). Both
passengers posted ride requests; both drivers used "Offer to take this ride →
Accept" (at asking price) on both requests.

1. **[HIGH — functional] [FIXED 2026-06-17 · OTA preview 7ad46423] Losing driver stuck on a phantom "confirmed" deal.**
   FIX: `negotiation.ts` now lets an inbound `MSG_CANCEL` cancel a locally
   `confirmed` nego (but never a `completed` trip; replay-safe). +2 regression
   tests (22/22 pass). Verified live: Driver B's two phantom `confirmed` deals
   flipped to `cancelled` on reload, Active tab emptied.
   "Offer to take this ride → Accept" at asking price is a one-tap *instant
   confirm* (not a pending offer). When two drivers accept the same request,
   the passenger correctly confirms the first and **cancels** the second
   (passenger nego → `cancelled`), but the losing driver's nego stays
   `confirmed` ("Waiting for the other party to come online to confirm…").
   Verified via `freeport.negotiations()`: passengers show `cancelled` for
   Driver B; Driver B shows `confirmed` for both. The losing driver believes
   they have a ride that's actually gone to someone else.
   Root cause: `packages/protocol/src/negotiation.ts:287` drops an inbound
   `MSG_CANCEL` when the local nego is already `confirmed` (guard returns null
   before the MSG_CANCEL handler at ~line 305). Compounded by `applyOutbound`
   (~line 185): a driver's `MSG_ACCEPT` optimistically self-sets `confirmed`
   before the counterparty acks. Fix idea: let an inbound `MSG_CANCEL` (hard,
   "filled — taken by another offer") transition `confirmed` → `cancelled`
   (it's authoritative from the intent owner); or don't mark the accepting
   side `confirmed` until the counterparty acks (use `accepted_by_us`).

2. **[ADDRESSED 2026-06-17] [LOW — functional] IP location only auto-detects on the first profile.**
   P1 auto-filled Vietnam/Quảng Ninh; P2/P3/P4 opened the location step with an
   empty country (had to pick manually). Likely the IP-geolocation providers
   rate-limit the same IP hit 4× in quick succession (ipwho.is/ipapi.co). Real
   users won't hit this, but worth a cache/retry/backoff or graceful default.

3. **[FIXED 2026-06-17 · OTA 8da97ab2] [LOW — UI/data] Distance shows "31 km" for same-area parties.**
   Both passengers pinned Bãi Cháy; drivers didn't pin (used detected
   province). Browse showed "31 km" for both — plausibly the driver's location
   is a province centroid vs the pinned point. Verify proximity is computed
   from comparable points (pinned vs pinned), not centroid vs pin.

Note: the **passenger** side of the double-book race is correct (one confirm,
loser cancelled). Only the **driver** side of the cancel fails to apply.

## Test-run results — 2026-06-17 (verified live via the 4-profile harness)

| # | Case | Result |
|---|------|--------|
| 1 | 2 drivers × 2 passengers offer fan-out | ✅ both passengers see both drivers |
| 2 | Double-book race (2 drivers accept same request) | 🐞→✅ bug found + fixed; loser now cancelled on all sides |
| 3 | Mutual cancel of a confirmed deal (request→agree) | ✅ both → cancelled; only that deal; no regression |
| 4 | Status progression picked_up → completed | ✅ propagates to both sides |
| 5 | Karma rating after completion (publish via PoW) | ✅ published, received, aggregated ("Excellent · avg 2.0") |
| 6 | Counter at a price ≠ asking | ✅ stays `open` (not auto-confirmed); peer gets Accept/Counter/Decline |
| 7 | Route (From/To) locked in counter form | ✅ read-only display, only time/price/note editable |
| 8 | Cancel request while a counter is pending | ✅ negotiation cancelled on BOTH sides (passenger + driver) |
| 9 | Post expiry → drops from Browse | ✅ observed (non-flexible requests expired & vanished; flexible = 24h) |
| 10| Simultaneous accept | ✅ covered by the double-book race (#2) — first confirm wins |

All assertions read from `freeport.negotiations()` / `freeport.state()` per profile.
