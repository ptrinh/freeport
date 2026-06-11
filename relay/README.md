# Freeport self-hosted relay (strfry)

Lightweight Nostr relay for the Freeport relay set. Runs anywhere Docker runs;
sized for a small Proxmox LXC.

## Deploy (Proxmox LXC)

1. Create an LXC (Debian 12, 1 vCPU, 512MB–1GB RAM, 8GB disk is plenty), install Docker.
   For a Dockge-managed host, drop this directory into the stacks folder instead.
2. Copy `docker-compose.yml` + `strfry.conf`, then:

   ```sh
   docker compose up -d
   ```

3. The relay listens on `ws://<host>:7777`. Put it behind your reverse proxy /
   Cloudflare tunnel for `wss://` (strfry itself does not terminate TLS).
   Set `realIpHeader = "x-forwarded-for"` in `strfry.conf` when proxied.
4. Edit `relay.info` in `strfry.conf` (name/pubkey/contact) before going public.

Run 2–3 instances on different nodes and add their `wss://` URLs to the agents'
`relays` list — they then count toward relay redundancy alongside the public set.

## Monitoring (Uptime Kuma)

The NIP-11 info document doubles as a health endpoint. Add an **HTTP(s) – Keyword**
monitor:

- URL: `http://<host>:7777/` (or the public `https://` URL)
- Request header: `Accept: application/nostr+json`
- Keyword: `Freeport`

The compose file's built-in healthcheck uses the same probe, so `docker ps`
shows `healthy`/`unhealthy` too.

## Notes

- Data lives in the `strfry-db` named volume (LMDB). Back up by snapshotting the LXC or `docker run --rm -v freeport_strfry-db:/db alpine tar c /db > backup.tar`.
- NIP-40 expiry: strfry stores expired events but won't serve them forever; run `strfry delete --age=...` via cron if you want eager cleanup (optional at our scale).
- Alternative relay: `nostr-rs-relay` works identically for our purposes if you prefer SQLite storage.
