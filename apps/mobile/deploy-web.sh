#!/usr/bin/env bash
# Build the web bundle and deploy to Cloudflare Pages.
#
# Works around a Cloudflare Pages quirk: it silently skips any upload path
# containing "node_modules", and Expo nests the icon fonts under
# assets/node_modules/@expo/... — so we rename that segment to "nm" and
# rewrite the bundle's references before deploying. Without this, the
# @expo/vector-icons fonts 404 and tab icons don't render.
set -euo pipefail

cd "$(dirname "$0")"
export CLOUDFLARE_ACCOUNT_ID=2edc401e8f3f074f198d7290691817a3

echo "▸ Exporting web bundle…"
npx expo export --platform web

# Upload web source maps to GlitchTip (debug-id based — no release coordination
# needed) BEFORE they're stripped from the public deploy below. `inject` stamps
# matching debug ids into the JS we ship and the maps we upload; GlitchTip then
# symbolicates crashes. Token comes from the env or a gitignored .env; skipped
# if absent so the deploy still works without it.
[ -f .env ] && { set -a; . ./.env; set +a; }
# Note: `expo export --platform web` does not emit .map files by default, so this
# only runs once web source-map output is enabled (and a token is present).
if [ -n "${SENTRY_AUTH_TOKEN:-}" ] && [ -n "$(find dist -name '*.map' -print -quit)" ]; then
  echo "▸ Uploading source maps to GlitchTip…"
  export SENTRY_URL="https://glitchtip.trinh.uk" SENTRY_ORG="phil-t" SENTRY_PROJECT="freeport"
  npx @sentry/cli sourcemaps inject dist
  npx @sentry/cli sourcemaps upload dist
else
  echo "▸ Skipping web source-map upload (no maps emitted, or no token)"
fi

# Strip source maps from the production deploy. Shipping .map files lets anyone
# reconstruct the original TypeScript (names, comments, structure) — a near-
# verbatim clone. Delete the maps and remove the //# sourceMappingURL= trailer
# from the JS so the browser doesn't even request them. Maps still exist locally
# for debugging; they just never reach Cloudflare.
echo "▸ Stripping source maps (no original-source leak in production)…"
find dist -name '*.map' -delete
find dist -name '*.js' -exec sed -i '' -e '/\/\/# sourceMappingURL=/d' {} +

echo "▸ De-node_modules-ing asset paths…"
if [ -d dist/assets/node_modules ]; then
  mv dist/assets/node_modules dist/assets/nm
  sed -i '' 's#assets/node_modules/#assets/nm/#g' dist/_expo/static/js/web/*.js
fi

# Icon fonts ship ~1.7 MB but the app renders a few dozen glyphs — subset them
# in place (same hashed filenames, still TrueType) so first-time visitors don't
# download ~97% dead glyphs. Fails the deploy if the used-glyph scan breaks.
echo "▸ Subsetting icon fonts to used glyphs…"
node scripts/subset-fonts.mjs dist

# Metro's bundle filenames are NOT content hashes (two different AppEntry
# bytes shipped under one name), and JS is cached 4h — rename every bundle to
# its true content hash so stale caches can never pin old code. Must run
# after every step that rewrites JS (nm rename, font subsetting).
echo "▸ Content-hashing JS bundles…"
node scripts/hash-bundles.mjs dist

# Canonical host: send www to the apex. The _redirects host rule is kept for
# when Pages honors it; the inline script below is the working fallback (the
# API token here can't create a zone-level 301 Redirect Rule — add one in the
# CF dashboard under Rules → Redirect Rules for a true 301).
echo "▸ Writing _redirects + inline www→apex redirect…"
cat > dist/_redirects <<'REDIR'
https://www.freeport.network/* https://freeport.network/:splat 301
/demo-app/* /esim-store/:splat 301
/i/* /index.html 200
REDIR
sed -i '' 's#<head>#<head><script>if(location.hostname==="www.freeport.network")location.replace("https://freeport.network"+location.pathname+location.search+location.hash);</script>#' dist/index.html

# Passkey domain association: iOS (AASA) + Android (assetlinks) must be able
# to verify freeport.network before native passkeys work. The Android cert
# fingerprint is Play App Signing's — printed in Play Console → App integrity.
echo "▸ Writing passkey well-known files…"
mkdir -p dist/.well-known
cat > dist/.well-known/apple-app-site-association <<'AASA'
{ "applinks": { "apps": [], "details": [ { "appID": "84T567KMYD.uk.trinh.freeport", "paths": ["/i/*"] } ] }, "webcredentials": { "apps": ["84T567KMYD.uk.trinh.freeport"] } }
AASA
cat > dist/.well-known/assetlinks.json <<'ALINKS'
[{
  "relation": ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
  "target": {
    "namespace": "android_app",
    "package_name": "uk.trinh.freeport",
    "sha256_cert_fingerprints": ["98:94:05:78:38:F1:6A:7D:46:F6:38:41:9D:8F:43:38:14:CC:38:85:93:FA:E0:EA:FB:D9:9A:06:90:57:2F:F8"]
  }
}]
ALINKS

# The offline single-file build fetches the wallet wasm from here (file://
# has a null origin) — allow it and let clients cache the 11MB blob.
cat > dist/_headers <<'HDRS'
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: browsing-topics=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  Content-Security-Policy: frame-ancestors 'self' https://freeport.network https://www.freeport.network https://freeport.trinh.uk; object-src 'none'; base-uri 'none'
HDRS
# CSP scope note: object-src 'none' + base-uri 'none' shut off two XSS
# amplifiers (plugin embeds and <base>-tag hijack) with zero risk to the app.
# We deliberately DON'T set script-src/default-src/connect-src: the app opens
# WebSockets to user-configured Nostr relays (any wss:// host — no fixed
# allowlist possible) and boots from inline scripts, so a strict policy would
# break core function. HSTS is 2y + preload to stop first-visit SSL-strip.
# Clickjacking note: NO X-Frame-Options — it can't express multiple origins, and
# SAMEORIGIN would block the mini-app WEB shell (freeport.network) from framing
# a demo served cross-origin at apps.freeport.network (same Pages project). CSP
# frame-ancestors above allows exactly the Freeport shell origins to frame, and
# blocks every other site (the modern, multi-origin-capable control).
cat >> dist/_headers <<'HDRS'
/breez_sdk_spark_wasm_bg.wasm
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=86400
/.well-known/apple-app-site-association
  Content-Type: application/json
/esim-store/freeport.json
  Access-Control-Allow-Origin: *
/insurance-store/freeport.json
  Access-Control-Allow-Origin: *
/id-verification/freeport.json
  Access-Control-Allow-Origin: *
/arbitrator/freeport.json
  Access-Control-Allow-Origin: *
HDRS

# Use our own PNG favicon. Expo's generated /favicon.ico ignores web.favicon
# here (stale default), so serve assets/favicon.png and point the link at it.
echo "▸ Overriding favicon with our logo…"
cp assets/favicon.png dist/favicon.png
sed -i '' 's#<link rel="icon" href="/favicon.ico" />#<link rel="icon" type="image/png" href="/favicon.png" />#' dist/index.html

echo "▸ Adding PWA (manifest, service worker, icons)…"
mkdir -p dist/icons
sips -z 192 192 assets/icon.png --out dist/icons/icon-192.png >/dev/null
sips -z 512 512 assets/icon.png --out dist/icons/icon-512.png >/dev/null
cp pwa/sw.js dist/sw.js
cp pwa/manifest.webmanifest dist/manifest.webmanifest
node -e '
const fs = require("fs");
const f = "dist/index.html";
let h = fs.readFileSync(f, "utf8");
const head = `    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#06080c" />
    <meta name="color-scheme" content="dark" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Freeport" />
    <link rel="apple-touch-icon" href="/icons/icon-192.png" />
    <style>
      /* Feel like a native app: no pinch/double-tap zoom, no iOS text auto-resize,
         no tap highlight; paint the dark brand bg before React mounts (no white flash). */
      html { color-scheme: dark; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
      html, body, #root { background-color: #06080c; }
      /* Fill the standalone-PWA viewport so there is no gap below the app at the
         bottom of the screen on iOS Home-Screen installs: plain 100% under-
         resolves in standalone Safari, so override with dvh (the real visible
         height) where supported. */
      html, body, #root { height: 100%; margin: 0; }
      @supports (height: 100dvh) { html, body, #root { height: 100dvh; } }
      * { -webkit-tap-highlight-color: transparent; }
      body { touch-action: pan-x pan-y; }
      /* Instant splash — painted from HTML while the JS bundle loads, so the
         first frame is the brand, not a blank screen. App.tsx fades+removes it
         (#ft-splash) once React mounts. */
      #ft-splash { position: fixed; inset: 0; z-index: 9999; display: flex;
        flex-direction: column; align-items: center; justify-content: center;
        gap: 14px; background: #06080c; color: #e7ecf3;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        transition: opacity .35s ease; padding: 24px; text-align: center; }
      #ft-splash img { width: 88px; height: 88px; border-radius: 20px; }
      #ft-splash .ft-title { font-size: 30px; font-weight: 800; letter-spacing: .5px; }
      #ft-splash .ft-load { font-size: 14px; color: #8b97a6; min-height: 18px; }
      #ft-splash .ft-load::after { content: ""; animation: ftdots 1.4s steps(4,end) infinite; }
      #ft-splash .ft-native { font-size: 12px; color: #5c6675; max-width: 280px; }
      #ft-splash .ft-copy { position: absolute; bottom: 22px; font-size: 11px; color: #4a5462; }
      @keyframes ftdots { 0%{content:""} 25%{content:"."} 50%{content:".."} 75%{content:"..."} 100%{content:""} }
      @media (prefers-reduced-motion: reduce) { #ft-splash .ft-load::after { content: "…"; animation: none; } }
    </style>
`;
const splash = `    <div id="ft-splash">
      <img src="/icons/icon-192.png" alt="Freeport" />
      <div class="ft-title">Freeport</div>
      <div class="ft-load">Loading</div>
      <div class="ft-native" id="ft-native">Use the native app for a better experience</div>
      <div class="ft-copy">© Phil T</div>
    </div>
    <script>(function(){try{var ua=navigator.userAgent||"";var ios=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);var os=ios?"iOS":/Android/.test(ua)?"Android":null;if(os){var e=document.getElementById("ft-native");if(e)e.textContent="Sử dụng "+os+" app để có trải nghiệm tốt nhất.";}}catch(_){}})();</script>
`;
const reg = `    <script>if("serviceWorker" in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){})})}</script>
    <script>
      // Self-heal a mid-deploy reload: if the APP BUNDLE fails to run (Pages
      // serves the SPA fallback as text/html during edge propagation), retry
      // ONCE. Strictly guarded — only _expo bundle scripts, only while the
      // splash is still up (app never mounted), one retry per session, flag
      // never auto-cleared (a v1 that reloaded on ANY script error and
      // re-armed on load caused an infinite refresh loop).
      window.addEventListener("error", function (e) {
        var el = e.target;
        if (!el || el.tagName !== "SCRIPT" || !el.src || el.src.indexOf("/_expo/") === -1) return;
        if (!document.getElementById("ft-splash")) return; // app already mounted — never reload under the user
        var k = "ft-bundle-retry";
        try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, "1"); } catch (_) { return; }
        var l = document.querySelector("#ft-splash .ft-load");
        if (l) l.textContent = "Updating";
        setTimeout(function () { location.reload(); }, 2500);
      }, true);
    </script>
`;
// Disable user scaling so pinch/double-tap zoom is off (native-app feel), and
// extend under the notch. Rewrite whatever viewport Expo emitted.
h = h.replace(/<meta name="viewport"[^>]*>/, "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover\" />");
if (!h.includes("user-scalable=no") && h.includes("</head>")) {
  h = h.replace("</head>", "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover\" />\n</head>");
}
if (!h.includes("manifest.webmanifest")) h = h.replace("</head>", head + "</head>");
if (!h.includes("serviceWorker")) h = h.replace("</body>", reg + "</body>");
// Inject the instant splash as the first thing inside <body> so it paints before
// the (large) JS bundle below it is fetched/parsed.
if (!h.includes("ft-splash")) h = h.replace(/<body([^>]*)>/, "<body$1>\n" + splash);
fs.writeFileSync(f, h);
console.log("  PWA tags + viewport + splash injected");
'

echo "▸ Publishing privacy policy at /privacy…"
mkdir -p dist/privacy
cp store/privacy.html dist/privacy/index.html

echo "▸ Publishing acceptable-use policy at /aup…"
mkdir -p dist/aup
cp store/aup.html dist/aup/index.html

# Account-deletion instructions — the URL the Play Data safety form points to
# for "how users request account deletion". Freeport is self-custodial, so this
# describes the in-app Delete account flow (Settings → Delete account).
echo "▸ Publishing account-deletion page at /delete-account…"
mkdir -p dist/delete-account
cp store/delete-account.html dist/delete-account/index.html

# The marketing/landing page (same files GitHub Pages serves from docs/) also
# lives at /intro on the app domain, so freeport.network/intro is the shareable
# front door. Assets are referenced relatively, so a straight copy works.
echo "▸ Publishing landing page at /intro…"
mkdir -p dist/intro
cp ../../docs/index.html dist/intro/index.html
cp ../../docs/favicon.png ../../docs/icon.png ../../docs/shot-deals.png ../../docs/shot-request.png \
   ../../docs/whitepaper.pdf ../../docs/whitepaper.vi.pdf dist/intro/

echo "▸ Publishing /llms.txt (agent-readable site guide)…"
cp store/llms.txt dist/llms.txt

echo "▸ Deploying to Cloudflare Pages…"
# Mini-app demo shop — a plain static page served next to the SPA. The app's
# add-flow also maps the repo's GitHub URL to this path.
echo "▸ Adding mini-app demos + SDK (/sdk.js)…"
mkdir -p dist/esim-store dist/insurance-store dist/id-verification dist/arbitrator
cp ../../examples/esim-store/{index.html,icon.png,freeport.json,qr.png} dist/esim-store/
cp ../../examples/insurance-store/{index.html,icon.png,freeport.json,qr.png} dist/insurance-store/
cp ../../examples/id-verification/{index.html,icon.png,freeport.json,qr.png} dist/id-verification/
cp ../../examples/arbitrator/{index.html,icon.png,freeport.json,qr.png} dist/arbitrator/
cp ../../packages/miniapp-sdk/freeport-sdk.js dist/sdk.js

npx wrangler pages deploy dist --project-name freeport --branch main --commit-dirty=true

# Censorship-resilient mirror: rebuild the single-file offline app from this
# exact dist and pin it to IPFS (Pinata). Content-addressed, so an unchanged
# build is a no-op; skipped when PINATA_JWT isn't set. Never fails the deploy.
echo "▸ Pinning offline single-file app + source archive to IPFS…"
node scripts/build-offline.mjs dist offline-freeport.html \
  && node scripts/pin-ipfs.mjs offline-freeport.html \
  || echo "  (IPFS mirror step failed — deploy unaffected)"
git -C ../.. archive --format=zip -o "$PWD/freeport-source.zip" HEAD \
  && node scripts/pin-ipfs.mjs freeport-source.zip freeport-source.zip \
  || echo "  (IPFS source mirror failed — deploy unaffected)"
rm -f freeport-source.zip

echo "✓ Live at https://freeport.network/ (and https://freeport.trinh.uk/)"
echo "✓ Privacy policy at https://freeport.network/privacy"
