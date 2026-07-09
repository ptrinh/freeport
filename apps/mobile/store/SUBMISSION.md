# Freeport — App Store & Play Store submission kit

Everything you need to publish **Freeport** (`uk.trinh.freeport`, v0.1.0) to the
Apple App Store and Google Play. Copy/paste the fields below into the consoles.

> ⚠️ **Before you start:** replace the placeholder support/privacy email
> `privacy@trinh.uk` (in `store/privacy.html` and below) with a real, monitored
> inbox if that alias isn't set up. Both stores email you there.

- **Privacy policy URL:** https://freeport.network/privacy  *(published by `deploy-web.sh`)*
- **Marketing URL:** https://freeport.network
- **Support URL:** https://freeport.network
- **Support email:** privacy@trinh.uk  *(confirm/replace)*
- **Category:** Travel (primary) · Lifestyle (secondary)
- **Age rating:** 17+ (user-generated content + unmoderated user communication)
- **Price:** Free

---

## 1. Store listing copy

**App name:** Freeport

**Subtitle (iOS, ≤30 chars):** Peer-to-peer rides & services

**Short description (Play, ≤80 chars):**
A decentralized P2P marketplace for rides, services & goods — no middleman.

**Promotional text (iOS, ≤170 chars):**
Negotiate rides, services and goods directly with people nearby. No company in
the middle, no commission, your keys and your price.

**Keywords (iOS, ≤100 chars, comma-separated):**
rideshare,p2p,nostr,marketplace,rides,services,decentralized,carpool,local,no commission

**Full description:**
```
Freeport is a decentralized, peer-to-peer marketplace. Request a ride, offer a
service, or trade goods directly with people near you — with no company in the
middle, no commission, and no account to create.

How it's different:
• No middleman. You deal directly with the other person and agree your own price.
• No sign-up. Your identity is a secure key created on your device — no email,
  no phone-number account, no password.
• You set the price. Negotiate openly; there's no platform fee or surge pricing.
• Private by design. Messages are end-to-end encrypted. Listings carry only a
  coarse, neighborhood-level location — never your exact coordinates.
• Built on Nostr. Freeport runs on an open protocol, not a private server, so no
  single company can shut it down, censor it, or sell your data.

Use it to:
• Find or offer rides nearby
• Offer or hire local services
• Buy and sell goods, including digital goods
• Build reputation through a transparent, peer-rated karma system

Freeport has no ads, no trackers, and no data brokers. Your key, your contacts,
your deals — under your control.
```

**What's New (release notes for v0.1.0):**
```
First public release of Freeport — a peer-to-peer marketplace for rides,
services and goods on the Nostr network. No account, no commission, your price.
```

---

## 2. iOS — App Privacy ("Data" section in App Store Connect)

Freeport's developer operates no backend and collects nothing centrally. Declare
the following (each as **NOT linked to identity** and **NOT used for tracking**):

| Data type | Collected? | Linked to user? | Tracking? | Purpose |
|-----------|-----------|-----------------|-----------|---------|
| Coarse Location | Yes | No | No | App Functionality (nearby listings, pickup point) |
| Precise Location | Yes* | No | No | App Functionality (set pickup point on device) |
| User Content (photos, messages) | Yes | No | No | App Functionality |
| Contact Info (phone number) | Yes** | No | No | App Functionality |
| Identifiers | No | — | — | — |
| Usage Data / Analytics | No | — | — | — |
| Diagnostics | No | — | — | — |

\* Precise location is used on-device to set your pickup point; only a **coarse**
geohash is ever published. If you'd rather not claim "precise," you can answer
**Coarse only** — the published data is coarse regardless.
\*\* The phone number is user-entered and user-published to a public network for
peer contact; it is never sent to a Freeport-operated server. Declare it because
it leaves the device (to public relays) at the user's choosing.

- **Tracking:** No. (No ATT prompt needed.)
- **Third-party SDKs collecting data:** None.

### Export compliance
Already declared in `app.json`: `ITSAppUsesNonExemptEncryption: false`. The app
uses only standard encryption (HTTPS + Nostr NIP-04) and qualifies for the
exemption — answer **"No"** to "Does your app use non-exempt encryption?" if asked.

### App Review notes (paste into "Notes")
```
Freeport is a decentralized peer-to-peer marketplace on the Nostr protocol.
There is NO login and NO account — tap "Create new account" on first launch to
generate an on-device key, then you're in. No credentials are required to review.

To test:
1. Launch → tap "Create new account" → choose role "Passenger".
2. On the main screen, tap "Pin location on map" (or allow location) and post a
   ride request with a price.
3. Open "Messages" and "Completed" tabs; open "Settings" to see profile/backup.

User communication is end-to-end encrypted (NIP-04) and user-generated listings
appear in "Browse". The app includes content moderation that blocks prohibited
listings at post time, user reporting (karma/negative ratings), and the ability
to back up the on-device key to the user's own iCloud Keychain.
```

### UGC compliance (Guideline 1.2) — already implemented, mention in notes if asked
- Listings are screened for prohibited content at post time (`src/moderation.ts`).
- Users can report bad actors (negative karma); reputation is shown on profiles.
- A blocklist/abuse path exists via karma + masked contact until a deal confirms.

---

## 3. Android — Play Console

### Data safety form
- **Does your app collect or share user data?** Yes (it transmits user-provided
  data to a decentralized network on the user's behalf; developer has no server).
- **Data types:**
  - *Location → Approximate location* — Collected, **not** shared with developer,
    purpose: App functionality. (Precise location stays on device.)
  - *Personal info → Phone number* — Collected, purpose: App functionality
    (peer contact); user-published, not developer-collected.
  - *Photos and videos* — Collected, purpose: App functionality.
  - *Messages* — collected/transmitted; end-to-end encrypted.
- **Is data encrypted in transit?** Yes.
- **Can users request deletion?** Yes — data is on-device; uninstalling + deleting
  any cloud backup removes it. Public network posts cannot be recalled (state this).
- **No advertising, no analytics SDKs.**

### Content rating questionnaire (IARC)
- Category: **Social / Communication / Marketplace**.
- Users can interact / communicate: **Yes** (encrypted DMs, public listings).
- Shares user location with other users: **Yes** (coarse, for listings).
- User-generated content: **Yes**.
- No violence, no sexual content, no gambling, no controlled-substance sales
  (prohibited content is blocked at post time). Expected rating: **Teen / 17+**.

### Other required Play forms
- **Target audience:** 18+ (avoid the "designed for families" path).
- **Privacy policy URL:** https://freeport.network/privacy
- **App access:** "All functionality is available without special access; no
  login required." (Provide the same review steps as the iOS notes above.)
- **Government apps / financial features / health:** No.

---

## 4. Screenshots (you provide)

Capture from a device/simulator. Minimum sets:
- **iOS:** 6.9" (1320×2868) **and** 6.5" (1242×2688) — at least 3 each. iPad 13"
  optional (the app supports tablet). Suggested screens: Welcome, Post a request
  (amount wheel), Browse, Messages, Profile/Settings.
- **Android:** Phone screenshots (min 2, 16:9 or 9:16), plus a **512×512** app icon
  and a **1024×500** feature graphic.

> I can capture clean simulator screenshots of these screens on request (the
> iPhone 17 / Pro Max simulators are available for the required sizes).

---

## 5. Wiring `eas submit` (after the store records + credentials exist)

`eas.json` has a `submit.production` block scaffolded with the fields to fill.

**iOS** — create an **App Store Connect API key** (App Store Connect → Users and
Access → Integrations → keys; Admin/App Manager role), download the `.p8`, and set:
```
EXPO_APPLE_APP_SPECIFIC_PASSWORD   (or use the ASC API key fields in eas.json)
```
Then: `eas submit -p ios --profile production --latest`

**Android** — create a **Google Play service account** (Play Console → Setup →
API access → link a GCP service account → grant "Release" permission), download
its JSON key, and point `eas.json`'s `serviceAccountKeyPath` at it. The **first**
`.aab` usually must be uploaded manually in Play Console to create the app; after
that: `eas submit -p android --profile production --latest`

---

## 6. Pre-submit checklist
- [ ] Replace placeholder `privacy@trinh.uk` with a monitored inbox.
- [ ] `freeport.network/privacy` loads (run `./deploy-web.sh`).
- [ ] Production builds finished (iOS build 4 `.ipa`, Android `.aab`).
- [ ] App Store Connect app record created (name, bundle, category, age 17+).
- [ ] Play Console app created (Data safety, content rating, target audience).
- [ ] Screenshots + icon + (Play) feature graphic uploaded.
- [ ] Privacy/App-Privacy/Data-safety forms filled per §2–3.
- [ ] Reviewer notes pasted.
- [ ] Submit credentials configured, then `eas submit` (or manual upload).
```
