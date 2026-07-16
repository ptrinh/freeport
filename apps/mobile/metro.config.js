// Monorepo support: let Metro resolve the symlinked @freeport/protocol
// workspace package and its dependencies from the repo root.
//
// getSentryExpoConfig wraps expo/metro-config's getDefaultConfig and adds the
// Sentry serializer, which stamps a DEBUG ID into every bundle + source map —
// without it GlitchTip can't match an OTA bundle to its map and native JS
// stacks symbolicate garbage (see the [fp-perf] mis-mapped pricing.ts frames).
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getSentryExpoConfig(projectRoot);
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
