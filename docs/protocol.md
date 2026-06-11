# Freeport Protocol v1

A decentralized P2P marketplace protocol over [Nostr](https://github.com/nostr-protocol/nips). Users broadcast trade **intents** into topic-scoped **markets**; personal **agents** discover counterpart intents and negotiate privately. No central operator, no matching server — coordination is relay-redundant pub/sub, matching is client-side.

> Naming note: the protocol/app name is held in one constant (`APP_NAME` / `PROTOCOL_TAG` in `packages/protocol/src/constants.ts`) pending trademark/domain clearance.

## 1. Concepts

| Term | Meaning |
|---|---|
| Market | A topic, addressed by a Nostr `t` tag, e.g. `sg-rideshare`. Optionally location-scoped via geohash `g` tags. |
| Intent | A signed, public, expiring statement of what a user offers or requests. |
| Payload schema | A versioned, vertical-specific JSON shape inside the intent, e.g. `rideshare/1`. The protocol is vertical-agnostic; only payloads are vertical-specific. |
| Negotiation | A private, encrypted exchange between exactly two agents about one intent. |
| Deal | A negotiation both sides accepted; concludes with contact exchange. Settlement is out of scope in v1. |

Identity is a secp256k1 keypair (standard Nostr identity), generated silently on first launch. Key backup is a NIP-49 `ncryptsec` blob (passphrase-encrypted, safe to store with any provider).

## 2. Event kinds

| Kind | Name | Type | Visibility |
|---|---|---|---|
| `32101` | `intent.offer` | addressable (NIP-01 30000–39999) | public |
| `32102` | `intent.request` | addressable | public |
| — | `negotiate.counter` | DM envelope | encrypted |
| — | `negotiate.accept` | DM envelope | encrypted |
| — | `negotiate.cancel` | DM envelope | encrypted |

Intents are **public** (default; chosen for discoverability — see §8). Negotiation messages are **never** standalone events: they are JSON envelopes carried inside encrypted DMs (§4.2).

Addressable kinds give us free update/withdraw semantics: relays keep only the latest event per `(pubkey, kind, d-tag)`. Withdrawing an intent = republishing the same `d` with an already-passed `expiration` and empty payload.

## 3. Intent events

### 3.1 Tags

```
["d", "<intent-id>"]            stable id across republishes (random 16 hex chars)
["t", "<market>"]               market topic, e.g. "sg-rideshare"
["expiration", "<unix-sec>"]    NIP-40; relays may drop after this
["freeport", "1"]               protocol marker + schema version
["g", "<geohash>"]              zero or more, for location-scoped discovery (recommended
                                precision 5 — see §7)
```

### 3.2 Content

JSON, signed as part of the event:

```jsonc
{
  "v": 1,                          // protocol schema version
  "side": "request",               // "offer" | "request"; MUST match the kind
  "market": "sg-rideshare",        // MUST mirror the t tag
  "schema": "rideshare/1",         // payload schema id
  "title": "Ride Orchard → Hougang at 15:45",
  "payload": { /* schema-specific, see §3.3 */ },
  "window": { "start": 1781251200, "end": 1781252100 },  // optional, unix sec
  "flex_minutes": 30,              // optional: how far window may shift in negotiation
  "expires_at": 1781270000         // MUST mirror the expiration tag
  // "payment": { ... }            // RESERVED for Lightning phase; absent in v1.
}
```

**Forward compatibility rule:** agents MUST ignore unknown fields. This is how the reserved `payment` field (Lightning invoices/quotes) lands later without a version bump.

Validation (receiver side): reject if content is not JSON, `v` ≠ supported version, `side` contradicts the kind, `market`/`schema`/`expires_at`/`payload` missing or mistyped, or the event is past expiry. Invalid intents are silently dropped.

### 3.3 Payload schemas

Schema ids are `"<vertical>/<version>"`. v1 ships one vertical:

**`rideshare/1`**
```jsonc
{
  "from": { "name": "Orchard Rd", "geohash": "w21z6v" },
  "to":   { "name": "Hougang Central", "geohash": "w21zgc" },
  "seats": 1,                  // optional
  "price_hint": "$12"          // optional free text in v1
}
```

New verticals add a schema doc + a client-side matcher; nothing else in the protocol changes. Agents that don't recognize a schema may still surface the intent to their human (generic match on market/side) but MUST NOT auto-negotiate it.

## 4. Negotiation

### 4.1 Negotiation id

A negotiation thread is identified by:

```
nego = "<intent.d>:<intent.pubkey>:<responder.pubkey>"
```

Both parties derive the same id independently. One intent can have many concurrent negotiations (one per responder); each is private and independent. Agents MUST drop messages whose claimed `nego` doesn't recompute from `(intent_d, intent author, sender)` — this blocks third-party injection.

### 4.2 Transport

v1 uses **NIP-04** encrypted DMs (kind 4, `p`-tagged to the counterparty) whose plaintext is the JSON envelope below. NIP-04 leaks metadata (who talks to whom); the planned upgrade is **NIP-17 gift-wrapped DMs**, which is a pure transport swap — the envelope is unchanged. Receivers try to parse every DM addressed to them and ignore anything that isn't a valid envelope.

Envelope:

```jsonc
{
  "v": 1,
  "type": "negotiate.counter",      // counter | accept | cancel
  "nego": "<negotiation id>",
  "intent_id": "<event id of the public intent>",
  "intent_d": "<intent d-tag>",
  "market": "sg-rideshare",
  "terms": {                         // counter: new terms; accept: terms accepted
    "window": { "start": 1781251200, "end": 1781252100 },
    "price": "$12",
    "note": "adjusted to my schedule"
  },
  "contact": "tg:@bob_drives",       // ONLY on accept — never earlier
  "reason": "outside my hours",      // only on cancel
  "ts": 1781240000
}
```

Contact details (and any other PII) MUST only appear in `accept` messages — by the time you reveal contact, you've committed to the deal.

### 4.3 State machine

Per-party view of one negotiation:

```
                  ┌──────────────────────────────────────────┐
                  │ counter (in/out, alternating, ≤ 8 rounds)│
                  ▼                                          │
discovery ──► open ──────────────────────────────────────────┘
                  │ send accept                │ recv accept
                  ▼                            ▼
          accepted_by_us               accepted_by_them
                  │ recv accept                │ send accept (human-gated)
                  └────────────► confirmed ◄───┘

any non-terminal state ── send/recv cancel ──► cancelled
any non-terminal state ── intent expiry ─────► expired
```

Rules:

1. **Opening.** The responder opens by sending `counter` (different terms) or `accept` (terms as posted). There is no separate "propose" message — the public intent is the standing proposal.
2. **Counters** alternate and carry complete terms (not diffs). A counter replaces whatever was on the table. Hard cap of **8 rounds** per side guards against runaway agent loops; after the cap only accept/cancel are legal.
3. **Accept** means "the terms currently on the table" and MUST carry the sender's contact. A deal is **confirmed only when both sides have sent accept** (the second accept may follow the first immediately). This double-accept closes the race where a counter and an accept cross in flight.
4. **Human gate.** Agents may counter autonomously within their owner's configured bounds, but the final accept is surfaced to the human unless the owner pre-authorized the rule (`auto_accept`).
5. **Cancel** is valid from any non-terminal state, by either side, with an optional reason. Terminal states (`confirmed`, `cancelled`, `expired`) accept no further messages.
6. **Expiry.** When the underlying intent expires, open negotiations expire with it.

### 4.4 Trust notes (v1 limits)

Anyone can post intents and negotiate in bad faith; v1's only mitigations are the human gate, the round cap, contact-only-on-accept, and key-based identity continuity. Reputation/anti-sybil is explicitly deferred.

## 5. Discovery

Agents subscribe with standard Nostr filters:

```jsonc
{ "kinds": [32101, 32102], "#t": ["sg-rideshare"], "since": <now - 24h> }
```

Location-scoped markets add `"#g": ["w21z6", …]` prefixes. Agents deduplicate by event id (same event arrives from several relays) and skip their own pubkey and own `d` tags.

## 6. Relays

Publish and subscribe to a redundant set: 5–10 public relays plus self-hosted ones (`relay/` in this repo). Properties that follow:

- **Reach requires intersection.** Two parties discover each other only if their relay sets share at least one relay. Default relay lists therefore ship with the app per market/region, and intents should be published wide.
- **Censorship-resistance** = any single relay (including ours) can vanish or censor without breaking the market, as long as one common relay survives.
- Relays MUST support NIP-01; SHOULD support NIP-40 (expiration) and addressable-event replacement. Both strfry and nostr-rs-relay qualify.

## 7. Geohash conventions

`g` tags carry standard base32 geohashes. Recommended tagging precision: **5 chars (≈ 4.9 × 4.9 km)**; payload locations use 6 (≈ 1.2 × 0.6 km). Proximity matching in v1 is shared-prefix length (5 shared ≈ same neighborhood). Known limitation: prefix comparison misses neighbors across cell boundaries; acceptable at city scale, fixable client-side (neighbor expansion) without protocol changes.

## 8. Privacy stance (v1 defaults)

- **Intents: public.** Chosen deliberately — an undiscoverable market is no market. Don't put PII in intents; locations are geohash-blurred, contact is withheld until accept.
- **Negotiations: encrypted** (NIP-04 now, NIP-17 next — gift wrap also hides the metadata graph).
- Future option (out of v1): encrypted-to-market intents using NIP-44 with a market-shared key for invite-only markets.

## 9. Versioning

- `v` (protocol) bumps only for breaking envelope/content changes; agents drop versions they don't speak.
- Payload schemas version independently (`rideshare/2` can coexist with `/1` on the same market).
- Additive fields (e.g. `payment`) are non-breaking per §3.2.

## 10. Reserved: settlement (later phase)

`payment` will carry `{ "method": "lightning", "bolt11" | "offer": … , "amount_msat": … }` inside terms/accept. Nothing in v1 parses it; agents ignore it today, which is exactly the compatibility we need.
