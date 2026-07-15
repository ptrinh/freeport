# Freeport — TODO

Short-lived operational tasks. Bigger deferred features live in
[`ROADMAP.md`](ROADMAP.md); this file is the running checklist of small,
concrete follow-ups.

## Code signing (expo-updates) — pre-link on a future binary

- [ ] Embed an OTA **code-signing certificate** (`updates.codeSigningCertificate`)
      in the next binary and wire `eas update` to sign.
  - **Why deferred (not in 1.7.0):** the cert is embedded at build time and
    cannot be added via OTA, but it is **untestable until a signed binary
    exists** — and a misconfigured setup makes the client reject *all* OTA for
    that runtime (silent OTA brick, only fixable with another binary). Its only
    benefit is the future self-hosted-OTA migration, which isn't happening yet.
    Not worth risking a fix-delivery release on.
  - **How, safely, when we do it:**
    1. `npx expo-updates codesigning:generate` + `codesigning:configure`.
    2. Build to a **new runtime** and ship to **TestFlight / Play internal**.
    3. Publish a test `eas update` to that runtime and confirm the signed update
       actually applies on the internal build **before** any public promotion.
  - Pairs with the "Self-hosted OTA updates on Cloudflare" roadmap item.

## Untranslated strings (English-only, need the 56-locale pass)

Ship via OTA once translated — no binary needed. Run the Opus locale agents
(per project convention) over these keys, then dedup-check + `tsc`.

- [ ] `"Mini-apps need a newer version of the app"` — mini-app fallback title
      (shown only on a binary without the react-native-webview pod).
- [ ] `"Update Freeport from your app store to open mini-apps."` — its body.

_Both come from the `react-native-webview` guard (`src/miniapps/MiniAppShell.tsx`).
Low urgency: the fallback only appears on pre-1.6.0 binaries opening a mini-app._

## Verify before promoting 1.7.0 to public

- [ ] On TestFlight / Play internal: wallet send + receive over Lightning,
      **lightning-address routes** (Breez native 0.18 → 0.19 bump), Face ID pay
      gate, voice memo + call ring (expo-audio migration).
- [ ] Provide `apps/mobile/store/play-service-account.json` so
      `eas submit --platform android` can upload the aab (currently blocked).
