// Monorepo support: let Metro resolve the symlinked @freeport/protocol
// workspace package and its dependencies from the repo root.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// nostr-tools exposes subpaths (nostr-tools/pool, /pure, …) via package
// "exports", which Metro doesn't resolve by default in SDK 52.
config.resolver.unstable_enablePackageExports = true;

// The Breez SDK wasm glue references import.meta.url (we never take that
// branch — src/wallet/breez.ts passes the wasm module explicitly — but Metro
// must still be able to parse the file).
config.transformer.unstable_transformImportMeta = true;

module.exports = config;
