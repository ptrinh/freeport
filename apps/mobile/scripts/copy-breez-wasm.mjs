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

// Patch the wasm-bindgen glue: its import.meta.url fallback makes Metro-built
// chunks throw "Cannot use 'import.meta' outside a module" at eval time
// (chunks load as classic scripts). The branch is unreachable for us —
// src/wallet/breez.ts always passes the compiled module to initSync().
import { readFileSync, writeFileSync } from 'node:fs';
const glue = join(root, 'node_modules/@breeztech/breez-sdk-spark/web/breez_sdk_spark_wasm.js');
const js = readFileSync(glue, 'utf8');
const needle = "module_or_path = new URL('breez_sdk_spark_wasm_bg.wasm', import.meta.url);";
if (js.includes(needle)) {
  writeFileSync(glue, js.replace(needle,
    "throw new Error('wasm path not provided'); // patched by copy-breez-wasm.mjs (Metro chunks are classic scripts)"));
  console.log('copy-breez-wasm: patched import.meta out of the wasm glue');
} else if (js.includes('import.meta')) {
  throw new Error('copy-breez-wasm: glue still contains import.meta in an unexpected form — update the patch');
} else {
  console.log('copy-breez-wasm: glue already patched');
}
