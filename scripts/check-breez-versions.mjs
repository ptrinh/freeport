#!/usr/bin/env node
/**
 * The wallet ships TWO Breez Spark SDKs — the wasm build for web and the
 * react-native build for iOS/Android. When their versions drift, web and
 * native wallets run different SDK behavior and shape mismatches land
 * platform-specifically (breezShapes.ts exists because of this; a lightning-
 * address route once broke the same way). This check fails CI on any NEW
 * drift between the two declared versions.
 *
 * KNOWN_SKEW grandfathers the drift that existed when the check was added.
 * When the versions are aligned (needs a coordinated bump + native binary
 * build + a lightning-address route re-check), empty the list so the check
 * enforces exact minor alignment from then on.
 */
import { readFileSync } from 'node:fs';

const KNOWN_SKEW = ['0.19/0.18']; // web-minor/native-minor pairs tolerated for now

const pkg = JSON.parse(readFileSync(new URL('../apps/mobile/package.json', import.meta.url), 'utf8'));
const web = pkg.dependencies['@breeztech/breez-sdk-spark'];
const native = pkg.dependencies['@breeztech/breez-sdk-spark-react-native'];
if (!web || !native) {
  console.error('breez check: expected both @breeztech/breez-sdk-spark and -react-native in apps/mobile/package.json');
  process.exit(1);
}

const minor = (range) => {
  const m = String(range).match(/(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}` : null;
};
const w = minor(web);
const n = minor(native);
if (!w || !n) {
  console.error(`breez check: could not parse versions (web=${web}, native=${native})`);
  process.exit(1);
}

if (w === n) {
  console.log(`breez versions aligned at ${w} (web=${web}, native=${native})`);
  process.exit(0);
}
if (KNOWN_SKEW.includes(`${w}/${n}`)) {
  console.log(`::warning::Breez SDK minor skew web=${web} vs native=${native} is grandfathered — align at the next coordinated SDK bump and empty KNOWN_SKEW in scripts/check-breez-versions.mjs.`);
  process.exit(0);
}
console.error(`breez check: web (${web}) and native (${native}) SDK minors differ — bump BOTH together (and re-check the lightning-address routes, see breezShapes.ts).`);
process.exit(1);
