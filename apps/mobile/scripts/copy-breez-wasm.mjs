// Copies the Breez SDK wasm binary into public/ so the web build can serve it.
// Runs on postinstall. The wasm-bindgen glue resolves the .wasm relative to
// import.meta.url, which Metro can't provide, so src/wallet/breez.ts fetches
// /breez_sdk_spark_wasm_bg.wasm explicitly instead. public/ is gitignored —
// this file is 11MB of third-party binary regenerated from node_modules.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/@breeztech/breez-sdk-spark/web/breez_sdk_spark_wasm_bg.wasm');
const dest = join(root, 'public/breez_sdk_spark_wasm_bg.wasm');

if (!existsSync(src)) {
  console.warn('copy-breez-wasm: SDK not installed, skipping');
  process.exit(0);
}
mkdirSync(join(root, 'public'), { recursive: true });
copyFileSync(src, dest);
console.log('copy-breez-wasm: public/breez_sdk_spark_wasm_bg.wasm ready');
