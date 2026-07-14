# Freeport mini-app SDK

One script makes a web page a Freeport mini-app in the **web** shell:

```html
<script src="https://freeport.network/sdk.js"></script>
```

It exposes the standard surfaces — `window.nostr` (NIP-07), `window.webln`
(WebLN) — plus `window.freeport.paySpark({address, sats | token})` for Spark /
stablecoin payments. In the **native** shell (mobile app WebView) these objects
are injected by the shell itself and this script exits immediately, so the same
page works in both.

How it works: the shell embeds the mini-app in a sandboxed cross-origin iframe
and hands it a dedicated `MessageChannel` port with `targetOrigin` pinned to
the app's registered origin. The SDK relays calls over that port as JSON-RPC.
The SDK is **not** part of the trusted computing base — the shell's firewall
re-validates every message, permissions are keyed to the browser-authenticated
frame origin, and every sensitive action (signing, decrypting, paying) shows an
approval dialog rendered in the parent DOM where the iframe cannot reach.

## Manifest (`freeport.json`)

Publish a manifest **next to your app's page** (resolved as
`new URL('freeport.json', launchUrl)` — per-app, so several apps can share an
origin):

```json
{
  "name": "eSIM Demo Shop",
  "icon": "icon.png",
  "description": "Buy an eSIM with your Freeport wallet.",
  "permissions": ["getPublicKey", "freeport.paySpark"]
}
```

Host your mini-app on **any https domain** — there is no Freeport-run registry
or approval, and nothing is limited to `freeport.network`. Users add it by
pasting your URL or scanning a QR. Requirements:

- `name` (required, ≤60 chars) and `icon` (path or https URL) drive the
  launcher tile; `permissions` (optional) previews which bridge methods you
  intend to call in the add-app dialog.
- **Web shell** (freeport.network in a browser): serve `freeport.json` with
  `Access-Control-Allow-Origin: *` (so the shell can read it cross-origin) and
  don't block framing — no `X-Frame-Options: DENY`, and if you set a CSP
  `frame-ancestors` it must include `https://freeport.network`.
- **Native shell** (mobile app): no CORS or framing constraints — just serve
  `freeport.json`.
- The manifest is **required**: a URL without a valid `freeport.json`
  cannot be added as a mini-app. It is still not a security boundary — the
  firewall judges every call regardless of what the manifest claims.
- The shell also watches for mini-app behavior at launch (the SDK acks the
  handshake; the native shim pings on first API access). A page that never
  touches the API shows a "may not be a mini-app" notice.

Notes:

- The SDK only activates when embedded (`window !== window.top` or an opener
  exists); in a normal tab it does nothing, so it never shadows a real NIP-07
  browser extension.
- `window.addEventListener('freeport:connected', ...)` fires when the shell
  handshake completes; `window.freeport.isConnected()` reports the state.
- Your page must be embeddable: don't send `X-Frame-Options: DENY` or a
  `frame-ancestors` policy that excludes `https://freeport.network`.

Example app: [`examples/esim-store`](../../examples/esim-store) — the eSIM Demo
Shop published at https://apps.freeport.network/esim-store/. Full architecture &
threat model: [`docs/miniapps-security.md`](../../docs/miniapps-security.md).
