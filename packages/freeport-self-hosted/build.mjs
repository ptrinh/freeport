/**
 * Bundle for publishing. Inlines the workspace-only `@freeport/protocol`
 * (not on npm) so the published package is self-contained, while leaving the
 * real npm dependencies external (resolved from node_modules at runtime).
 */
import { build } from 'esbuild';
import { rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });

await build({
  // relay.ts is its own output so http.ts's dynamic import('./relay.js')
  // resolves at runtime (only loaded when ENABLE_RELAY=1).
  entryPoints: ['src/stdio.ts', 'src/http.ts', 'src/relay.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outdir: 'dist',
  sourcemap: false,
  external: [
    '@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/*',
    'nostr-tools', 'nostr-tools/*',
    'express', 'zod', 'web-push', 'expo-server-sdk', 'ws',
  ],
});

console.log('bundled dist/stdio.js + dist/http.js (protocol inlined, deps external)');
