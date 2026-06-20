# Freeport — Roadmap / Deferred work

Items intentionally postponed, with enough context to pick them up later.

## Lock-screen live progress (Live Activity) — deferred until native build

**Goal:** show deal/trip progress on the phone lock screen + Dynamic Island
(like Grab/Be/Xanh SM), driven by the existing fulfillment stages
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
