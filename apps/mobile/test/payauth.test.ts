/**
 * Payment auth gate (payAuth.ts) — the pref/threshold decision matrix in
 * authorizePayment, plus requireAuth's degrade-vs-deny behavior. Tested on the
 * native surface (Platform.OS = 'ios'); the platform authenticate call is
 * mocked via expo-local-authentication.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

// prefs.ts drives the policy; reconfigured per test.
const loadPrefs = vi.fn(async () => ({ payAuthRequired: true, payAuthThresholdSats: 0 }));
vi.mock('../src/prefs', () => ({ loadPrefs: () => loadPrefs() }));
// passkey.ts is only touched on the web surface; harmless stubs here.
vi.mock('../src/passkey', () => ({
  passkeySupported: vi.fn(async () => false),
  hasLocalPasskeyHint: vi.fn(() => false),
}));

// Native module registry probe + the auth module itself.
const requireOptionalNativeModule = vi.fn((_name: string): unknown => ({}));
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) => requireOptionalNativeModule(name),
}));
const hasHardwareAsync = vi.fn(async () => true);
const isEnrolledAsync = vi.fn(async () => true);
const authenticateAsync = vi.fn(async (): Promise<{ success: boolean }> => ({ success: true }));
vi.mock('expo-local-authentication', () => ({
  hasHardwareAsync: () => hasHardwareAsync(),
  isEnrolledAsync: () => isEnrolledAsync(),
  authenticateAsync: () => authenticateAsync(),
}));

import { authorizePayment } from '../src/payAuth';

beforeEach(() => {
  vi.clearAllMocks();
  loadPrefs.mockResolvedValue({ payAuthRequired: true, payAuthThresholdSats: 0 } as any);
  requireOptionalNativeModule.mockReturnValue({} as any);
  hasHardwareAsync.mockResolvedValue(true);
  isEnrolledAsync.mockResolvedValue(true);
  authenticateAsync.mockResolvedValue({ success: true } as any);
});

describe('authorizePayment — pref/threshold matrix', () => {
  it('pref OFF → allowed without prompting', async () => {
    loadPrefs.mockResolvedValue({ payAuthRequired: false, payAuthThresholdSats: 0 } as any);
    expect(await authorizePayment(999999, 'send')).toBe(true);
    expect(authenticateAsync).not.toHaveBeenCalled();
  });

  it('pref ON, threshold 0 → prompts for any amount', async () => {
    expect(await authorizePayment(1, 'send')).toBe(true);
    expect(authenticateAsync).toHaveBeenCalledTimes(1);
  });

  it('threshold N → amounts below N skip the prompt', async () => {
    loadPrefs.mockResolvedValue({ payAuthRequired: true, payAuthThresholdSats: 1000 } as any);
    expect(await authorizePayment(500, 'send')).toBe(true);
    expect(authenticateAsync).not.toHaveBeenCalled();
  });

  it('threshold N → amounts at or above N prompt', async () => {
    loadPrefs.mockResolvedValue({ payAuthRequired: true, payAuthThresholdSats: 1000 } as any);
    expect(await authorizePayment(1000, 'send')).toBe(true); // == threshold
    expect(await authorizePayment(2000, 'send')).toBe(true); // > threshold
    expect(authenticateAsync).toHaveBeenCalledTimes(2);
  });

  it('unknown/undefined/NaN amount always prompts (can not prove under a threshold)', async () => {
    loadPrefs.mockResolvedValue({ payAuthRequired: true, payAuthThresholdSats: 1000 } as any);
    expect(await authorizePayment(null, 'send')).toBe(true);
    expect(await authorizePayment(undefined as any, 'send')).toBe(true);
    expect(await authorizePayment(NaN, 'send')).toBe(true);
    expect(authenticateAsync).toHaveBeenCalledTimes(3);
  });

  it('unreadable prefs fail toward prompting (threshold defaults to 0)', async () => {
    loadPrefs.mockRejectedValue(new Error('keychain locked'));
    expect(await authorizePayment(1, 'send')).toBe(true);
    expect(authenticateAsync).toHaveBeenCalledTimes(1);
  });
});

describe('authorizePayment — requireAuth outcomes', () => {
  it('user failing/dismissing the prompt → denied', async () => {
    authenticateAsync.mockResolvedValue({ success: false } as any);
    expect(await authorizePayment(5000, 'send')).toBe(false);
  });

  it('no native module linked → gate skipped (allowed), authenticate never called', async () => {
    requireOptionalNativeModule.mockReturnValue(null as any);
    expect(await authorizePayment(5000, 'send')).toBe(true);
    expect(authenticateAsync).not.toHaveBeenCalled();
  });

  it('no hardware / not enrolled → gate skipped (allowed)', async () => {
    hasHardwareAsync.mockResolvedValue(false);
    expect(await authorizePayment(5000, 'send')).toBe(true);
    expect(authenticateAsync).not.toHaveBeenCalled();
  });

  // NOTE (intended, per the "don't lock funds behind an OS error" comment):
  // a THROWN module/OS error fails OPEN — the payment is allowed. Contrast with
  // a clean success:false (real user denial) above, which denies.
  it('authenticate THROWING fails OPEN (allowed) — module error is not a denial', async () => {
    authenticateAsync.mockRejectedValue(new Error('LAContext exploded'));
    expect(await authorizePayment(5000, 'send')).toBe(true);
  });
});
