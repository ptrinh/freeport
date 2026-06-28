# Freeport translation glossary

Read this before translating any string in `src/locales/`. It defines the
app-specific meaning of ambiguous words so translations stay correct.

**Give this file to every translator** (human or AI) and include it in any
translation prompt.

## What Freeport is

A decentralized, peer-to-peer marketplace on the Nostr protocol for **rides**
and **local services / goods**. There is **no company in the middle**, and
there are **NO promotions, discounts, sales, coupons, or special offers** in the
app. Any wording that implies a promotion/discount is wrong.

## Ambiguous terms — meaning and how to translate

| English term | Means in this app | Translate as | Do NOT translate as |
|---|---|---|---|
| **deal** / **deals** | a confirmed agreement/transaction between two users (a booked ride or service) | transaction / agreement / booking | promotion, discount, sale, bargain, coupon, "good deal" |
| **offer** / **send offer** / **offer to take this ride** | a price bid/proposal a driver or provider makes in response to a request | bid / proposal / quote | promotional offer, discount, special offer |
| **counter** / **counter-offer** / **send counter** | a revised price bid in negotiation | counter-proposal / counter-bid | counter-discount, counter-promotion |
| **request** | a rider's/buyer's posted need (ride or service wanted) | request / posted need | order, complaint |
| **post** / **listing** | a published intent (a request or an offer) | post / listing | advertisement, promotion |
| **karma** | a user's reputation score, earned from rated deals | reputation score (keep "karma" if natural) | luck, fate, destiny |
| **network** / **in your network** | people you have completed deals with (your trust graph) | your contacts / trust circle | internet/telecom network, social-media network |
| **provider** | a user offering services or goods (the seller side) | provider / seller | supplier company, vendor brand |
| **driver** / **passenger** | the two rideshare roles | driver / passenger | — |
| **pickup** / **destination** | a ride's start and end points | pickup point / destination | — |
| **live location** / **track** | real-time GPS shared between the two parties during a deal | live location / track | live broadcast, livestream |
| **relay** | a Nostr relay (a server that passes public events) | keep "relay" or transliterate | sports relay, relay race |
| **notification server** | a self-hostable server that watches relays and sends push alerts | keep "notification server" | notification company |

## Keep verbatim (do not translate)

`Freeport`, `Nostr`, `relay` names, `nsec`, `npub`, `NIP-04`, `Docker`,
`Umbrel`, `URL`, `MCP`, `karma` (if it reads naturally), and all placeholders:
`{deals}`, `{partners}`, `{inNetwork}`, `{masked}`, `{amount}`, `{track}`, etc.

## Style

- Clear, friendly, concise — match the surrounding UI tone.
- Use the locale's normal app terminology, not literal word-for-word.
- For Vietnamese specifically: "deal" -> "giao dịch", "offer/counter" ->
  "đề nghị / trả giá", "Backup account" -> "Sao lưu tài khoản" (never "Xuất").

## Worked examples (right vs wrong)

- "Rate this deal" -> VI "Đánh giá giao dịch này" (right) / "Đánh giá ưu đãi này" (WRONG: ưu đãi = promotion)
- "New offer on your post" -> VI "Đề nghị mới cho bài đăng của bạn" (right) / "Ưu đãi mới ..." (WRONG)
- "{deals} deals" -> the count of completed transactions, not promotions.
