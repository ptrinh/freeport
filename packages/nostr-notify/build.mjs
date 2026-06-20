/** Bundle for publishing — inlines @freeport/protocol, keeps npm deps external. */
import { build } from 'esbuild';
import { rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outdir: 'dist',
  sourcemap: false,
  external: ['express', 'nostr-tools', 'nostr-tools/*', 'web-push', 'zod'],
});

console.log('bundled dist/index.js (protocol inlined, deps external)');
