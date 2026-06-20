# Relay write-policy — community self-policing

The client-side filter (`apps/mobile/src/moderation.ts`) keeps honest clients
clean, but a determined actor can publish straight to a relay with a custom
script. The **relay is the real gate**: a community that runs its own relay
decides what it will store and serve. strfry supports a write-policy plugin
(`relay.writePolicy.plugin`) that runs on every incoming event and can reject
it. This is where prohibited-content rules belong for true enforcement.

## What to enforce

Reject (don't store) any intent event (kinds 32101/32102) whose content matches
the prohibited ("Group 2", outright-illegal) denylist — the same rules as the
client filter. Optionally also:

- **Require NIP-13 PoW** (e.g. ≥ 16 leading-zero bits) on intents → raises
  per-post cost, kills cheap flooding.
- **Rate-limit** per pubkey / per source IP (e.g. N intents per hour).
- **Allowlist / banlist** of pubkeys the community has vouched for or removed.
- **Size / expiry sanity** (reject missing `expiration`, oversized content).

The denylist and the client's `moderation.ts` should be kept in sync — ideally
generated from one shared list.

## strfry write-policy (sketch)

`strfry.conf`:

```
relay {
  writePolicy { plugin = "/etc/strfry/write-policy.sh" }
}
```

`write-policy.sh` — strfry pipes one JSON event per line on stdin, expects a
decision per line on stdout (`{"id": "...", "action": "accept"|"reject", "msg": "..."}`):

```bash
#!/usr/bin/env bash
# Reject prohibited intents; require PoW; everything else accepted.
jq -c '
  . as $e
  | ($e.event.content // "")            as $content
  | ($e.event.kind // 0)                as $kind
  # leading-zero-bits of the id (PoW)
  | ($e.event.id // "")                 as $id
  | (
      # prohibited terms (kept in sync with moderation.ts)
      ["child porn","csam","underage","cocaine","heroin","methamphetamine",
       "mdma","fentanyl","buy gun","firearm for sale","ak-47","grenade",
       "cloned card","fullz","cc dump","counterfeit","fake passport",
       "money launder","ddos for hire","ransomware","human traffick",
       "organ for sale","rhino horn","hitman","contract kill"]
      | map(select(($content | ascii_downcase | contains(.))))
      | length
    ) as $hits
  | if ($kind == 32101 or $kind == 32102) and $hits > 0
    then {id: $e.event.id, action: "reject", msg: "blocked: prohibited content"}
    else {id: $e.event.id, action: "accept"}
    end
'
```

(PoW and rate-limit checks are easiest in a small Go/JS plugin rather than jq;
the snippet above shows the content-denylist gate, which is the core ask.)

## Federation note

Different communities can run relays with different policies — a stricter
relay for a family-friendly market, a more permissive one elsewhere — and
clients choose which relays to read/write. Geo-sharded topics
(`vn_hanoi_…`) make it natural for each area's community to run and police its
own relay. Enforcement is therefore plural, not central: no single operator
decides for everyone, but each operator is accountable for what their relay
serves.
