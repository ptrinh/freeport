/**
 * REGRESSION (GlitchTip #13/#14): opening the Wallet tab on a binary without
 * the Breez TurboModule (runtime <= 1.4.1) hard-crashed the app (SIGABRT).
 * The package's module init calls TurboModuleRegistry.getEnforcing, which
 * throws, and Metro reports init errors to the GLOBAL handler — so the guard
 * must probe TurboModuleRegistry.get() and bail BEFORE importing the package.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const breezImported = vi.fn();
let nativeModulePresent = false;

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  TurboModuleRegistry: {
    get: (name: string) => (nativeModulePresent && name === 'BreezSdkSparkReactNative' ? {} : null),
  },
}));
vi.mock('@breeztech/breez-sdk-spark-react-native', () => {
  breezImported();
  if (!nativeModulePresent) {
    throw new Error("TurboModuleRegistry.getEnforcing: 'BreezSdkSparkReactNative' could not be found");
  }
  return { default: {} };
});

import { importBreezNative } from '../src/wallet/breezNative';

beforeEach(() => { breezImported.mockClear(); });

describe('importBreezNative (pre-wallet binary guard)', () => {
  it('TurboModule missing → null, package JS NEVER imported (no global crash)', async () => {
    nativeModulePresent = false;
    expect(await importBreezNative()).toBeNull();
    expect(breezImported).not.toHaveBeenCalled();
  });

  it('TurboModule present → returns the module', async () => {
    nativeModulePresent = true;
    expect(await importBreezNative()).toBeTruthy();
    expect(breezImported).toHaveBeenCalled();
  });
});
