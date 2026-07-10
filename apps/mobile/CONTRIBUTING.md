# Contributing to the Freeport mobile app

Expo / React Native app that also ships as a PWA and a desktop (Tauri) shell.
This guide covers how the code is laid out, the conventions to follow, and how
to run and verify your changes.

## Layout

| Path | Responsibility |
|---|---|
| `App.tsx` | App shell only: navigation, tab wiring, top-level state, the live-trip viewer, and glue. No tab bodies live here. |
| `src/tabs/*.tsx` | One file per tab — `BrowseTab`, `PostTab`, `MessagesTab`, `SettingsTab`, plus `Onboarding`. Screen-level components. |
| `src/ui/theme.ts` | The `s` stylesheet, `palette`, and theme application. |
| `src/ui/fields.tsx` | Shared UI components (form fields, rows, buttons, pickers) reused across tabs. |
| `src/ui/format.ts` | Pure display formatters (money, dates/clock, place names, amounts). |
| `src/ui/alerts.ts` | Alert / confirm / maps-open helpers. |
| `src/*.ts` | Domain logic — one module per concern (`identity`, `pricing`, `maps`, `locations`, `deals`, `push`, …). Unit-testable without React Native. |
| `src/locales/*.ts` | i18n catalogs (see conventions below). |
| `test/*.test.ts` | Vitest unit tests for the pure `src/` modules. |

Rule of thumb: **a screen goes in `src/tabs/`, a reusable widget in `src/ui/`,
and anything with logic worth testing in `src/` as its own module.**

## Conventions

- **i18n is English-source.** Wrap user-facing strings in `t()` (and `tn()` for
  plurals). The key *is* the English string — `t('Proposed terms')` — so English
  needs no catalog. Translations live in `src/locales/*.ts`. Those catalogs are
  generated: **do not hand-edit them** (the one exception is `vi.ts`, the
  Vietnamese catalog, which is maintained by hand). Add new strings by wrapping
  them in `t()`; the extraction tooling picks them up.
- **Pure logic lives in `src/` with a test.** If a change has real logic
  (parsing, matching, currency, geohash, filtering), put it in a `src/` module
  and add a `test/*.test.ts`. Tab/UI files should stay thin.
- **One home for shared values.** Don't re-declare shared helpers or constants
  locally. Formatters come from `src/ui/format.ts`, styles/palette from
  `src/ui/theme.ts`, shared components and the `IoniconName` type from
  `src/ui/fields.tsx`, and country data (`COUNTRY_NAME`, `COUNTRY_CODES_AZ`)
  from `src/locations.ts`. Import them, don't copy them.
- **No behavior change without a test when fixing a bug.** Reproduce the bug in
  a test first, then fix it.

## Testing

Tests run under Vitest in a plain Node environment (`vitest.config.ts` scopes
them to `test/`), so they never load the Expo/RN runtime. When a `src/` module
transitively imports React Native or Expo, stub them at the top of the test:

```ts
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
```

Keep test files out of the app's import graph — they are never bundled.

## Running

```sh
npm install            # from apps/mobile
npx expo start         # dev server (press w for web, i/a for iOS/Android)
npm test               # vitest unit tests
npx tsc --noEmit       # type-check
```

For the web/PWA build (catches asset and `require()` issues `tsc` misses):

```sh
npx expo export --platform web --output-dir /tmp/web-check
```

## Pull requests

Before opening a PR, make sure both are green:

- `npx tsc --noEmit` — no type errors.
- `npm test` — all tests pass.

Bug fixes should include a regression test. Keep UI files thin and push logic
down into tested `src/` modules.
