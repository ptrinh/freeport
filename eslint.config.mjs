// Minimal lint backstop — deliberately NOT a style linter. It exists to catch
// the two patterns this codebase has already been bitten by:
//   • empty catch blocks that silently swallow real failures (a swallowed
//     withdraw once left a "cancelled" listing live), and
//   • `as any` casts in protocol/client code (an `as any` once silently
//     killed all DM delivery — see client.ts).
// Both are warnings, surfaced in CI via --max-warnings so NEW occurrences
// fail the build once the existing count is worked down.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-fresh/**',
      'apps/mobile/offline-freeport.html',
      'apps/desktop/**',
      'demo/**',
      'examples/**',
      '**/*.config.*',
      'apps/mobile/scripts/**',
      'apps/mobile/locales/**',
    ],
  },
  {
    files: ['apps/mobile/src/**/*.{ts,tsx}', 'apps/mobile/App.tsx', 'packages/*/src/**/*.ts'],
    // Existing disable-directives target rules this config doesn't enable
    // (exhaustive-deps etc.) — don't count them against the gate.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: { parser: tseslint.parser },
    // react-hooks is registered (rules off) only so the codebase's existing
    // `eslint-disable-next-line react-hooks/exhaustive-deps` comments resolve.
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooks },
    rules: {
      // Require at least a comment inside a catch — `catch {}` with no
      // explanation is indistinguishable from an accidental swallow.
      'no-empty': ['warn', { allowEmptyCatch: false }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
