#!/usr/bin/env bash
# Build the Freeport web app into ./web-dist so the self-hosted server serves
# it at / (http.ts picks the dir up automatically when index.html exists).
# Mirrors apps/desktop/build-web.sh: plain expo export + the node_modules path
# rename + icon-font subsetting. Requires apps/mobile deps to be installed.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MOBILE="$HERE/../../apps/mobile"
OUT="$HERE/web-dist"

echo "▸ Exporting web bundle (Expo)…"
( cd "$MOBILE" && npx expo export --platform web --output-dir "$HERE/.web-export" )

echo "▸ Staging into web-dist…"
rm -rf "$OUT"
mv "$HERE/.web-export" "$OUT"

# Rename Expo's assets/node_modules nesting (matches deploy-web/desktop, and
# some reverse proxies/tools skip node_modules paths).
if [ -d "$OUT/assets/node_modules" ]; then
  mv "$OUT/assets/node_modules" "$OUT/assets/nm"
  find "$OUT" -name '*.js' -exec sed -i.bak 's#assets/node_modules/#assets/nm/#g' {} + && find "$OUT" -name '*.bak' -delete
fi

echo "▸ Subsetting icon fonts to used glyphs…"
( cd "$MOBILE" && node scripts/subset-fonts.mjs "$OUT" )

# Own favicon (Expo ships a stale default).
cp "$MOBILE/assets/favicon.png" "$OUT/favicon.png" 2>/dev/null || true

echo "✓ web app ready at packages/freeport-self-hosted/web-dist"
