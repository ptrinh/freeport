# Freeport

A decentralized peer-to-peer marketplace for rides, services, and goods, built
on [Nostr](https://nostr.com). Your identity is a keypair on your device — no
account, no central server.

- **App:** https://freeport.trinh.uk (web/PWA) · [iOS](https://apps.apple.com/us/app/freeport-p2p-marketplace/id6781200901) · Android
- **Whitepaper:** [English](whitepaper.pdf) · [Tiếng Việt](whitepaper.vi.pdf)

## Self-host the server

[`server/`](server/) is a self-hostable Nostr **MCP endpoint** that doubles as a
**push notifier** for the network. Run your own with one command:

```bash
cd server
docker compose up -d
```

See [`server/README.md`](server/README.md) for configuration and the Umbrel app.
