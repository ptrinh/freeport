/**
 * Scan-button gating (user report: no Scan on a 1.5.2 store binary that
 * demonstrably ships ExpoCamera). The probe must check BOTH layers: some
 * binaries return null from requireOptionalNativeModule while the module
 * sits in the JSI registry — either one present means the camera exists.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

vi.mock('expo-modules-core', () => ({ requireOptionalNativeModule: vi.fn() }));

import { requireOptionalNativeModule } from 'expo-modules-core';
import { hasExpoNativeModule } from '../src/tabs/wallet/cameraModule';

const req = requireOptionalNativeModule as ReturnType<typeof vi.fn>;

beforeEach(() => { req.mockReset(); });
afterEach(() => { delete (globalThis as any).expo; });

describe('hasExpoNativeModule', () => {
  it('true when requireOptionalNativeModule finds it', () => {
    req.mockReturnValue({});
    expect(hasExpoNativeModule('ExpoCamera')).toBe(true);
  });

  it('true when req() returns null but the JSI registry has it (1.5.2 regression)', () => {
    req.mockReturnValue(null);
    (globalThis as any).expo = { modules: { ExpoCamera: {} } };
    expect(hasExpoNativeModule('ExpoCamera')).toBe(true);
  });

  it('false when neither layer knows the module', () => {
    req.mockReturnValue(null);
    expect(hasExpoNativeModule('ExpoCamera')).toBe(false);
  });

  it('a throwing probe reads as absent, never as a crash', () => {
    req.mockImplementation(() => { throw new Error('boom'); });
    expect(hasExpoNativeModule('ExpoCamera')).toBe(false);
  });
});
