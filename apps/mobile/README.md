# Freeport mobile (Expo / React Native)

Minimal client: browse a market, post an intent, confirm incoming deals,
back up your key. **Scaffold status:** code-complete but not yet run on a
device — install and launch with:

```sh
cd apps/mobile
npm install
npx expo start        # scan QR with Expo Go
```

Why React Native (Expo) over Swift: direct reuse of `@freeport/protocol`
(TypeScript), one codebase for both platforms, and Expo Go demos on a real
phone with no signing/provisioning — the fastest path to the recorded demo.

Notes
- Identity: generated silently on first launch into the platform keystore
  (`expo-secure-store`); backup is a NIP-49 `ncryptsec` blob (Key tab).
- `react-native-get-random-values` + `expo-crypto` polyfill crypto for
  nostr-tools; RN ships WebSocket natively.
- The app is intentionally "thin": full agent auto-matching lives in the CLI
  agent for v1. The app covers post → see counters → tap accept → deal.
