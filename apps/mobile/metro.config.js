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

// NOTE: the Breez wasm glue's import.meta.url fallback is patched out in
// scripts/copy-breez-wasm.mjs (postinstall) — Metro emits chunks as classic
// scripts, where import.meta is a SyntaxError at eval time.

module.exports = config;
