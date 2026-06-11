#!/usr/bin/env bash
# End-to-end demo over PUBLIC relays.
#
# Normally agent A and agent B run on two different machines:
#   machine B:  npx tsx packages/agent/src/cli.ts run --config demo/driver.config.json
#   machine A:  npx tsx packages/agent/src/cli.ts run --config demo/rider.config.json --post <intent>
#
# This script runs both on one machine (separate key profiles) for a quick
# self-contained demo. The message path is still: A → public relays → B.
set -euo pipefail
cd "$(dirname "$0")/.."

# Stamp today's 15:45–16:00 window into the ride request.
INTENT="$(mktemp -t freeport-intent).json"
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
const spec = JSON.parse(readFileSync('demo/ride-request.json', 'utf8'));
const d = new Date(); d.setHours(15, 45, 0, 0);
if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1); // tomorrow if past
spec.window = { start: Math.floor(d.getTime()/1000), end: Math.floor(d.getTime()/1000) + 15*60 };
spec.expires_at = Math.floor(Date.now()/1000) + 6*3600;
writeFileSync(process.argv[1], JSON.stringify(spec, null, 2));
console.log('ride request window:', new Date(spec.window.start*1000).toLocaleString());
" "$INTENT"

echo "── starting driver agent (background, log: /tmp/freeport-driver.log)"
npx tsx packages/agent/src/cli.ts run --config demo/driver.config.json >/tmp/freeport-driver.log 2>&1 &
DRIVER_PID=$!
trap 'kill $DRIVER_PID 2>/dev/null || true' EXIT
sleep 3

echo "── starting rider agent (foreground) and posting the ride request"
echo "   when the driver's 16:00 counter arrives, answer 'y' to confirm."
npx tsx packages/agent/src/cli.ts run --config demo/rider.config.json --post "$INTENT"
