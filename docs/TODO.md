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

## Native secp256k1 for the next binary (perf)

- [ ] Pre-link a native crypto path (e.g. `react-native-quick-crypto`, or a
      native secp256k1 module wired into nostr-tools' `verifyEvent`/ECDH) in
      the NEXT binary.
  - **Why:** [fp-perf] on iPhone A15/Hermes measured ~25ms per schnorr verify
    and ~100ms per DM decrypt (pure-JS @noble). The connect burst
    (~30 events) is now spread across frames (16ms yield queue — NB: RN treats
    `setTimeout(0)` as an immediate, it never yields), so the UI no longer
    freezes, but each decrypt still eats a frame. Native secp is the real cure
    (~100× faster), and it's binary-only — JS/OTA can't fix it.

## Verify before promoting 1.7.0 to public

- [ ] On TestFlight / Play internal: wallet send + receive over Lightning,
      **lightning-address routes** (Breez native 0.18 → 0.19 bump), Face ID pay
      gate, voice memo + call ring (expo-audio migration).
- [ ] Provide `apps/mobile/store/play-service-account.json` so
      `eas submit --platform android` can upload the aab (currently blocked).
