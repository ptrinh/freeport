import { defineConfig } from 'vitest/config';

// Unit tests for the pure helper modules only (no React Native runtime). Scoped
// to test/ so vitest never tries to load the Expo/RN app files. Test files are
// not imported by App.tsx, so they are never bundled into the app or web build.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
