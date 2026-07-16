#!/usr/bin/env bash
# Publish an OTA update AND upload its iOS/Android source maps to GlitchTip,
# so native JS stack traces symbolicate against the real source. Debug IDs are
# stamped into bundles + maps by the Sentry metro serializer (metro.config.js
# uses getSentryExpoConfig) — sentry-expo-upload-sourcemaps matches on those,
# no release coordination needed.
#
# Usage: ./deploy-ota.sh "update message"
set -euo pipefail

cd "$(dirname "$0")"

MSG="${1:?usage: ./deploy-ota.sh \"update message\"}"

# GlitchTip credentials — same .env the web deploy uses (gitignored).
[ -f .env ] && { set -a; . ./.env; set +a; }

echo "▸ Publishing OTA update…"
EAS_SKIP_AUTO_FINGERPRINT=1 npx eas-cli update --branch production --message "$MSG"

# `eas update` leaves the export in dist/ (bundles + .map per platform when the
# Sentry serializer is active). Upload maps right away, before anything else
# overwrites dist/ (deploy-web.sh reuses the same directory).
if [ -n "${SENTRY_AUTH_TOKEN:-}" ]; then
  if [ -n "$(find dist -name '*.map' -print -quit 2>/dev/null)" ]; then
    echo "▸ Uploading OTA source maps to GlitchTip…"
    export SENTRY_URL="${SENTRY_URL:-https://glitchtip.trinh.uk}" SENTRY_ORG="${SENTRY_ORG:-phil-t}" SENTRY_PROJECT="${SENTRY_PROJECT:-freeport}"
    npx sentry-expo-upload-sourcemaps dist
  else
    echo "⚠ No .map files in dist/ — check the Sentry metro serializer (metro.config.js)"
  fi
else
  echo "▸ Skipping source-map upload (no SENTRY_AUTH_TOKEN in env/.env)"
fi

echo "✓ OTA published + source maps handled"
