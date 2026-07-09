#!/usr/bin/env bash
# Produce the static web bundle that the desktop app ships, into
# apps/desktop/dist. Tauri loads it as the webview frontend AND the Rust host
# server embeds it (include_dir!) to serve on the LAN. Run automatically by
# tauri's beforeBuildCommand.
#
# This is a PLAIN export (no Cloudflare/PWA post-processing from deploy-web.sh):
# Tauri serves assets from the bundle root, so absolute "/" asset paths resolve,
# and there's no node_modules path-filtering quirk to work around.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MOBILE="$HERE/../mobile"
OUT="$HERE/dist"

echo "▸ Exporting web bundle (Expo)…"
( cd "$MOBILE" && npx expo export --platform web --output-dir "$HERE/.web-export" )

echo "▸ Staging into apps/desktop/dist…"
rm -rf "$OUT"
mv "$HERE/.web-export" "$OUT"

# Expo nests icon fonts under assets/node_modules/@expo/… — harmless for Tauri,
# but rename to match deploy-web so behaviour is identical across surfaces.
if [ -d "$OUT/assets/node_modules" ]; then
  mv "$OUT/assets/node_modules" "$OUT/assets/nm"
  # Rewrite references in the JS bundles.
  find "$OUT" -name '*.js' -exec sed -i.bak 's#assets/node_modules/#assets/nm/#g' {} + && find "$OUT" -name '*.bak' -delete
fi

# Own favicon (Expo ships a stale default).
cp "$MOBILE/assets/favicon.png" "$OUT/favicon.png" 2>/dev/null || true

echo "✓ desktop web bundle ready at apps/desktop/dist"
