# Forking Freeport

Freeport is designed to be forked: relays are dumb pub/sub, all logic is
client-side, and every deployment-specific value is listed below. A community
can stand up its own market — its own name, city, vertical, relays and
services — by changing configuration, not architecture.

The protocol itself (event kinds 32101/32102, negotiation envelopes — see
`docs/protocol.md`) is shared. Forks that keep the same kinds and schemas
interoperate on the same relays; forks that want isolation pick their own
market keys (or their own relays) and coexist without touching each other.

## The 10-minute fork (protocol + agent only)

```sh
git clone https://github.com/ptrinh/freeport-app.git
cd freeport-app
npm install && npm run build && npm test
```

Then change, in `packages/protocol/src/constants.ts`:

| Constant | What it is |
|---|---|
| `APP_NAME` | Your product name — all naming flows from here |
| `DEMO_MARKET` / `SERVICE_MARKET` | Market keys (e.g. `hanoi-rideshare`). Posts and subscriptions meet on these topic tags — your key = your market |
| `DEFAULT_RELAYS` | The relay set your clients speak to. Works with the big public relays out of the box; run your own with `relay/` (strfry + docker compose, Proxmox-LXC-sized) |

Verticals are payload schemas (`rideshare/1`, `service/1`) plus a client-side
matcher in `packages/protocol/src/matching.ts` — add a new vertical by adding
a payload interface and a `matchYourVertical()` branch.

## Mobile app (Expo)

Everything identifying this deployment lives in `apps/mobile/app.json` and a
handful of constants:

| Where | What to change |
|---|---|
| `app.json`: `name`, `slug`, `owner` | Your app name and **your** Expo account |
| `app.json`: `ios.bundleIdentifier`, `android.package` | Your reverse-DNS ids (currently `uk.trinh.freeport`) |
| `app.json`: `updates.url` | Your EAS project's update URL (created by `eas init`) |
| `app.json`: `android.config.googleMaps.apiKey` | **Your** Google Maps Android key. Android Maps keys ship inside the APK and are not secret, but MUST be restricted in Google Cloud Console to your package name + signing-cert SHA-1, or anyone can burn your quota |
| `app.json`: `extra.webBase` and `src/webBase.ts` `FALLBACK` | Your web origin (used in shared live-trip links) |
| `src/telemetry-core.ts`: `GLITCHTIP_DSN`, `APTABASE_HOST` | Your crash/analytics endpoints — or empty them to ship with telemetry off (it is opt-in in Settings either way) |
| `src/prefs.ts`: `notifyEndpoint` default | Your notification server URL (see below) |
| `App.tsx` support email + self-host links | Your contacts |
| `src/nominatim.ts` User-Agent | Your app/contact per Nominatim's usage policy |
| `apps/mobile/store/` | Freeport-branded store assets — replace with your own |

Credentials that are **not** in the repo (bring your own, paths referenced by
`eas.json`): Apple ASC API key (`.p8`), Play service-account JSON, signing
keys. The `.gitignore` already excludes them.

Build & release: `eas build`/`eas submit` for stores, `eas update --channel
production` for OTA JS updates, `bash deploy-web.sh` for the web PWA (set
`CLOUDFLARE_ACCOUNT_ID` and the Pages project name inside to yours).

## Services (all optional, all self-hostable)

| Service | Where | Run it |
|---|---|---|
| Relay | `relay/` | `docker compose up -d` — strfry with a Freeport-tuned config + write policy |
| Notification server + MCP | `packages/nostr-mcp/` | `docker compose up -d` — content-blind Web Push/Expo push watcher (`ENABLE_NOTIFY=1`) and a read-only MCP endpoint for agents; point the app's "Notification service URL" at it |
| CLI agent | `packages/agent/` | `npx tsx src/cli.ts run --config your-agent.json` — see `demo/` for two-agent configs |

None are required to exist for the market to function — they add push
notifications and agent tooling on top of the public relays.

## Names to search for

A fork should leave no trace of the upstream deployment. Grep for these and
replace what you find:

```sh
grep -rn "trinh.uk\|ptrinh\|uk.trinh\|Freeport" --include="*.ts*" --include="*.json" \
  packages apps relay demo | grep -v node_modules | grep -v locales
```

(`Freeport` appears in UI copy and the 55 locale catalogs — rename via
`APP_NAME` first, then sweep the catalogs if you rebrand.)

## License

MIT — see [LICENSE](LICENSE). Fork it, rename it, sell with it. Attribution
appreciated, not required.
