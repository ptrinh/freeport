import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Unit tests for the pure helper modules only (no React Native runtime). Scoped
// to test/ so vitest never tries to load the Expo/RN app files. Test files are
// not imported by App.tsx, so they are never bundled into the app or web build.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // breez.ts lazily imports this subpath (only inside connectBreez, never
      // in tests). Metro resolves it at runtime, but the Breez SDK omits it
      // from its package `exports`, so Vite's resolver 404s on it during static
      // import analysis. Point it at the real file so resolution succeeds; the
      // breez send tests vi.mock it so it's never actually loaded.
      '@breeztech/breez-sdk-spark/storage': resolve(
        here, 'node_modules/@breeztech/breez-sdk-spark/web/storage/index.js',
      ),
    },
  },
});
