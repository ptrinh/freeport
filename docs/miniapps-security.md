# Mini-apps: shell & firewall architecture, and why it resists exploitation

Freeport mini-apps are third-party web apps that run *inside* Freeport with
the user's portable identity (NIP-07) and self-custodial wallet (WebLN +
Spark). That sentence should scare you: it means arbitrary, unreviewed
JavaScript runs one bridge away from a signing key and real money. This
document explains the architecture that makes it survivable, and the specific
attacks the design was built against.

Code map (everything under `apps/mobile/src/miniapps/`):

| File | Role |
|---|---|
| `firewall.ts` | **Policy** — the single choke point every request passes through |
| `bridge.ts` | **Mechanism** — parses RPCs, consults the firewall, executes via signer/wallet |
| `shim.ts` | The injected `window.nostr`/`window.webln`/`window.freeport` (native shell) |
| `MiniAppShell.tsx` | Hardened WebView host (native) |
| `MiniAppShell.web.tsx` | Sandboxed cross-origin iframe host (web) |
| `ApprovalDialog.tsx` | The consent UI, shared by both shells |
| `walletAdapter.ts` | BridgeWallet over the app's WalletProvider |
| `store.ts` | Persistence (SecureStore / localStorage) |
| `packages/miniapp-sdk/freeport-sdk.js` | postMessage SDK for the web shell (served at freeport.network/sdk.js) |

Adversarial test suites: `test/miniapp-firewall.test.ts`,
`test/miniapp-bridge.test.ts` — every property claimed below has a test that
attacks it.

## 1. Threat model

The mini-app is **fully hostile**. Assume it controls every byte of every
message it sends, replaces our injected shim/SDK with its own code, navigates
itself anywhere, embeds iframes, floods the bridge, and lies about amounts,
origins, and identities. The user is **well-meaning but fallible**: they will
click through dialogs if flooded, and can be phished by lookalike domains.

What must never happen, in order of severity:

1. The nsec (or any key material) reaches the mini-app.
2. The wallet pays without the user's per-payment or standing consent.
3. The app signs events the user didn't approve — especially kinds that
   impersonate them in the marketplace (DMs, listings, karma, receipts).
4. The app reads encrypted history (deals, friend chats) without consent.
5. Permissions granted to app A leak to app B, another origin, or another
   account on the same device.

Out of scope (accepted, documented): the mini-app exfiltrating data the user
*deliberately approved for it* (an approved-decrypt plaintext, the pubkey);
denial-of-service against itself; phishing that happens entirely inside the
mini-app's own UI against its own users.

## 2. Architecture: policy/mechanism split with one choke point

```
   Mini-app (hostile JS, any origin)
      │  window.nostr / window.webln / window.freeport   ← shim/SDK (untrusted!)
      │  JSON-RPC over postMessage
      ▼
   Bridge (bridge.ts) ─ parse, sanitize, translate to facts
      ▼
   Firewall (firewall.ts) ─ THE decision: allow / ask / deny
      ▼                                   │ask
   Execute (signer.ts / wallet)     ApprovalDialog (native/parent DOM)
```

Three load-bearing decisions:

**The firewall is the only place that says yes.** Every RPC — regardless of
shell, platform, or transport — funnels through `firewall.evaluate()`, a pure
function over `(origin, method, params, time)`. There is no second code path,
no "fast lane", no method that skips it. Policy being pure TS with injected
time means the entire security surface is table-testable without a WebView,
and a policy fix is a one-file OTA.

**The bridge translates, it does not decide.** `bridge.ts` turns raw attacker
input into *verified facts* before the firewall sees them — most importantly,
the amount of a `webln.sendPayment` is parsed from the bolt11 invoice
**native-side** (`bolt11Sats`); an app-claimed amount is ignored, so lying
about price buys nothing. Sign requests pass through `sanitizeTemplate()`,
which whitelists exactly `{kind, content, tags, created_at}` — a forged
`pubkey`, `id`, or `sig` on the template is dropped, and identity always
comes from the key, never from page data.

**The shim/SDK is deliberately outside the trusted base.** The injected shim
(native) and `freeport-sdk.js` (web) are convenience relays. A malicious app
can replace them entirely — and gains nothing, because everything they send
is re-validated on the native/parent side. Nothing that must be true for
security lives in WebView-land.

## 3. The permission model (what the firewall enforces)

| Surface | Default | Grantable? |
|---|---|---|
| `getPublicKey` / `webln.getInfo` | ask once | yes (per app) |
| `signEvent`, ordinary kind | ask per kind | yes — per-app **kind allowlist** |
| `signEvent`, **sensitive kind** | ask EVERY time | **never** — `grantKind()` throws |
| `nip04/44.encrypt` | ask per peer | per-peer only |
| `nip04/44.decrypt` | ask per peer | per-peer only — **no blanket grant exists** |
| `webln.makeInvoice` | allow (receive-only), rate-limited | — |
| `webln.sendPayment` | ask | auto-allow only under the user-set per-app daily cap |
| `freeport.paySpark` | ask EVERY time | never — caps don't apply |
| `freeport.getBalance` / `getLocation` | ask | yes (per app) |
| `freeport.saveFile` | ask EVERY time | never — one file per approval |
| anything else | **deny** | — |

**What the read methods deliberately do NOT include.** Only *private* signals
are bridged: wallet balance and coarse home location, neither of which exists
on any relay. Everything public about an identity — reputation score, karma,
ratings, completed deals, account age — is derivable from the npub the app
already learns via `getPublicKey`, so re-exposing it through the bridge would
be security theater (it would look like a guarded secret while being freely
queryable). The app is expected to look those up itself; the `insurance-store`
example shows exactly this split (`deriveReputationFromNpub()` for public data,
`getBalance`/`getLocation` for private). Bridged reads return coarse summaries
only — a sats total, a country/state/city — never raw events or coordinates.

**Saving files.** `freeport.saveFile` lets an app hand a generated document
(receipt, ticket, certificate) to the OS save/share sheet — necessary because
a plain `<a download>` is blocked inside both the native WebView and the
sandboxed web iframe. It always asks (never a standing grant), the approval
shows the filename, params are validated (name ≤200 chars, a well-formed MIME
type, base64 ≤3 MB), and the shell routes it through `expo-sharing` (native)
or a parent-document blob download (web). The app never gets filesystem
access — it proposes one file and the user's share sheet decides where it
goes.

Sensitive kinds (`ALWAYS_ASK_KINDS`): `0, 3, 4, 5, 1059, 30018, 30078,
32101–32105`. The rationale is marketplace-specific: kind 4/1059 lets an app
impersonate the user in deal negotiations; 32101/32102 posts listings as
them; 32103/32104 forge reputation; 30078 could overwrite the encrypted
settings/profile sync bundle; 5 deletes their events. These can never become
standing grants — even a tampered persistence blob can't smuggle them in
(`restore()` filters them out; there's a test that tries).

Payment defense-in-depth, because "drain the wallet" is the highest-value
target:

- **Per-app daily cap** (default 0 = every payment asks) — auto-allow exists
  only under a cap the user explicitly set.
- **Global cross-app daily cap** — N small apps can't jointly drain what one
  app couldn't.
- **Cooldown** between auto-approved payments — no rapid-fire drip-drain
  under the cap.
- **Zero/unknown-amount invoices always ask** — the "amountless invoice"
  trick gets a dialog, not an auto-pay.
- **Spark/stablecoin payments (`paySpark`) always ask**, full stop.

Cross-cutting limits: sign rate (10/min/origin), invoice rate, and an
**ask-flood cap** — at most 3 pending approval dialogs per origin, so an app
cannot stack dialogs until the user reflex-taps Allow. Every verdict lands in
a bounded audit log (what, when, which app, how much) that doubles as the
spend history in Settings.

## 4. Shell hardening (native)

The WebView is treated as enemy territory; the shell constrains what the
territory can do:

- **Static shim, zero interpolation.** The injected script is a constant
  string — no app name, URL, or user data is ever concatenated into injected
  code, so there is no injection vector on our side of the fence. (Tested:
  the shim contains no `${`.)
- **Main frame only, before content loads.** Iframes inside the mini-app get
  no bridge at all.
- **Origin is the trust unit, tracked on every navigation.** Permissions are
  keyed to the https origin; `onNavigationStateChange` re-points the bridge,
  so a page that navigates to another origin instantly loses everything
  (tested: the origin-swap attack). Navigation to a foreign origin doesn't
  even load in the shell — it opens in the system browser, away from the
  bridge. Several launcher tiles may point at different PATHS of one origin
  (e.g. the two demo shops under freeport.network) — they are separate tiles
  but deliberately share ONE permission record: same-origin pages can
  navigate to, embed, and read each other, so per-path grants would be a
  false boundary (tested: restore() collapses any per-tile divergence a
  tampered store tries to smuggle in).
- **Verification is a label, never a policy input.** At add time the shell
  probes `freeport.json` next to the app page; a valid manifest marks the
  tile "verified" and previews the permissions the app intends to request.
  No manifest ⇒ an amber Unverified warning at add time and in the shell
  header — the app can still be added (no gatekeeper). At launch, a page
  that never touches the mini-app API (SDK handshake ack on web, first
  API-global access in the native shim) gets a dismissible "may not be a
  mini-app" notice. None of these signals grant or deny anything — the
  firewall judges every call identically either way, because a hostile page
  can serve a perfect manifest.
- **One incognito WebView per app** — app A cannot read app B's cookies or
  storage. `https` only; `file:`, `data:`, `javascript:` URLs never load;
  popups and multiple windows are disabled.
- **Escape-encoded responses.** Replies are delivered via
  `injectJavaScript`, and response bodies can contain attacker-influenced
  text (e.g. decrypted plaintext) — they're JSON-stringified with
  `U+2028/U+2029` and `<` escaped so nothing breaks out of the string
  context (tested with a `</script>` payload).
- **Message hygiene.** Oversized payloads (>256 KB) and malformed frames are
  dropped *silently* — no error oracle for probing. In-flight RPCs are
  capped; overflow gets a generic `busy`.

## 5. Shell hardening (web)

On web you cannot inject into a cross-origin iframe — so the web shell flips
the mechanism while keeping the identical firewall:

- **Sandboxed iframe**: `sandbox="allow-scripts allow-same-origin
  allow-forms"` — no popups, no top-navigation (the mini-app can't redirect
  the Freeport tab), no modals.
- **MessageChannel handshake, targetOrigin pinned.** On every iframe load the
  shell mints a fresh `MessageChannel` and posts one port to the frame with
  `targetOrigin` set to the registered origin. A frame sitting on any other
  origin never receives a port — the browser enforces delivery. This is
  *stronger* than the native origin tracking: origin authentication is done
  by the browser, per message, not by our navigation bookkeeping.
- **The approval dialog lives in the parent DOM**, which a cross-origin
  iframe cannot draw over (same-origin policy). Against bait-click timing
  (the app places a button where Allow will appear and rushes you), the
  Allow buttons **arm only after 600 ms** — Firefox-style. Native uses the
  same delay.
- **The SDK activates only when embedded** (`window !== window.top` or an
  opener exists) so it can never shadow a real NIP-07 extension in a normal
  tab, and it exits immediately under the native shim — one page, both
  shells, no double-provider confusion.

## 6. Registration & lifecycle defenses

- **Add-time**: only `https://` origins; URLs with embedded credentials are
  rejected; **punycode hosts are refused outright** (lookalike-domain
  phishing — `freeport.netw0rk` in Cyrillic — is the cheapest way to steal a
  grant). An injectable **blocklist** can kill known-bad origins even after
  they were added (a Nostr-published community blocklist is the planned
  feed).
- **Storage is not trusted either**: `restore()` re-validates everything —
  sensitive kinds are stripped from allowlists, launch URLs that escaped
  their origin are snapped back, spend records for unregistered origins are
  dropped. A device-level attacker who can edit SecureStore already owns the
  key, so this is about *corruption and downgrade* resistance, not secrecy.
- **Logout wipes grants** (`freeport.miniapps` is in `wipeAllLocalData`):
  permissions are per-identity — an app trusted to sign as account A must
  never inherit that trust for account B on the same device.
- **Removing an app** deletes its permissions *and* its spend/rate state, so
  remove-and-re-add is not a cap-reset trick worth anything (re-add starts
  at zero grants too).

## 7. Attacks we explicitly designed against (and where the test lives)

| Attack | Defense | Test |
|---|---|---|
| Origin swap: navigate to evil.com after grants | permissions keyed + re-checked per origin; foreign nav leaves the shell | `origin tracking` (bridge), `registry gate` (firewall) |
| Lying about payment amount | amount parsed from invoice native-side | `payments` (bridge) |
| Zero-amount invoice under a cap | unknown amount always asks | `payments` (firewall) |
| Drip-drain under the cap | cooldown between auto-payments | `payments` (firewall) |
| Many apps splitting the drain | global cross-app daily cap | `payments` (firewall) |
| Dialog flooding until the user taps Allow | ask-flood cap (3/origin) + serialized dialogs | `ask-flood` (both) |
| Bait-click on the Allow position | 600 ms delayed-arm buttons, parent-DOM dialog | `ApprovalDialog` (manual/UI) |
| "Always allow" on a DM/listing kind | ungrantable — grant call throws, approval stays one-shot | `signEvent` (bridge) |
| Forged pubkey/id/sig in a sign template | field-whitelist sanitizer; signer derives identity from the key | `sanitizeTemplate` |
| Tampered persistence smuggling grants | restore-time re-validation | `persistence` (both) |
| Response injection back into the page | U+2028/29 + `<` escaping | `response encoding` |
| Malformed-message probing | silent drops, no error oracle | `message parsing` |
| Punycode lookalike origin | refused at add time | `origin validation` |
| Grants surviving logout | store wiped with identity | `identity.ts` key list |
| Wallet/signer internals leaking in errors | generic error strings only | `payments` (bridge) |

## 8. Honest limits — what this design does NOT protect

- **Approved data is gone.** Once the user approves a decrypt or reveals the
  pubkey, the mini-app can exfiltrate it — there is no reliable egress
  filtering inside a WebView/iframe (`fetch` wrappers are bypassable via
  image beacons, CSS, form posts). That's why the firewall sits at the
  *data-granting* boundary, not the network boundary, and why decrypt is
  per-peer, per-approval.
- **The shells are the TCB.** A compromised Freeport app/web origin (XSS in
  the parent, malicious OTA) defeats everything — same as it already would
  for the wallet and keys without mini-apps. The web page's existing
  hardening (no third-party scripts, CSP-free but self-contained bundles)
  is the real perimeter there.
- **User judgment is still a dependency.** The dialogs make consequences
  explicit ("lets the app act as you", amount + destination shown from
  verified data) and rate-limits keep consent meaningful, but a user who
  approves a hostile request is making a real grant. Reputation carries the
  rest, as everywhere else in Freeport.
- **Availability isn't defended.** A mini-app can hang itself, render junk,
  or waste its own rate budget; the shell only guarantees the *host* stays
  responsive (bounded queues, bounded dialogs).

## 9. Extending safely — rules for future work

1. New bridge method? It must appear in `BRIDGE_METHODS`, get a `case` in
   `firewall.decide()` (unknown methods are denied by default), and ship
   with adversarial tests in the same PR. If it moves money, it starts
   life as always-ask.
2. Never interpolate anything into injected code. If a value must reach the
   page, send it as a JSON-encoded RPC response through the existing
   escaper.
3. Never trust a number, string, or origin that arrived from the frame —
   re-derive it (parse the invoice, read `event.origin`, recompute the
   fact) on the trusted side.
4. Anything that weakens a default (new grant shape, higher cap, new
   auto-allow) needs a written rationale in this file.
