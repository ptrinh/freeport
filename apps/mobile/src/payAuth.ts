/**
 * Payment authentication gate — an extra "prove it's you" step right before
 * money moves (wallet Send confirm, mini-app webln/paySpark). This is a
 * UX-layer lock against someone holding your unlocked phone, NOT a
 * cryptographic bind: the wallet seed is already in memory while the app runs.
 *
 * Surfaces:
 *  - Native: expo-local-authentication (Face ID / Touch ID / BiometricPrompt,
 *    with device-PIN fallback). Guarded dynamic import via the native-registry
 *    probe, same pattern as passkey.ts — binaries that don't link the module
 *    yet simply have no gate.
 *  - Web: a bare WebAuthn user-verification assertion, only when this browser
 *    has used a Freeport passkey before (otherwise `credentials.get` would
 *    hard-fail for everyone without one and lock them out of paying).
 *  - Offline HTML (file://): no secure context → no gate.
 *
 * Policy lives in prefs: `payAuthRequired` (default ON) + `payAuthThresholdSats`
 * (0 = every payment; N = only payments ≥ N sats or of unknown amount).
 */
import { Platform } from 'react-native';
import { loadPrefs } from './prefs';
import { passkeySupported, hasLocalPasskeyHint } from './passkey';

async function nativeAuthModule(): Promise<any | null> {
  try {
    // Probe the registry before importing so binaries without the module
    // linked don't blow up inside Metro's loader (see passkey.ts).
    const core: any = await import('expo-modules-core').catch(() => null);
    if (!core?.requireOptionalNativeModule?.('ExpoLocalAuthentication')) return null;
    return await import('expo-local-authentication');
  } catch { return null; }
}

/** Whether THIS device/browser can actually show an auth prompt. Drives the
 *  Settings row (live toggle vs "unavailable" note). */
export async function payAuthAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') {
    try { return (await passkeySupported()) && hasLocalPasskeyHint(); } catch { return false; }
  }
  const mod = await nativeAuthModule();
  if (!mod) return false;
  try { return (await mod.hasHardwareAsync()) && (await mod.isEnrolledAsync()); } catch { return false; }
}

/**
 * Show the platform auth prompt. Resolves true to proceed, false when the USER
 * failed or dismissed it. Missing capability (no module, no enrollment, no
 * passkey on this browser) resolves true — the gate degrades to absent rather
 * than freezing funds, mirroring how a device without a passcode behaves.
 */
export async function requireAuth(reason: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (!(await payAuthAvailable().catch(() => false))) return true;
    try {
      // Any user-verified assertion counts — we don't need the PRF here, just
      // "the passkey owner is present". rpId defaults to this origin's domain.
      await (navigator as any).credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          userVerification: 'required',
        },
      });
      return true;
    } catch { return false; }
  }
  const mod = await nativeAuthModule();
  if (!mod) return true;
  try {
    if (!(await mod.hasHardwareAsync()) || !(await mod.isEnrolledAsync())) return true;
    const res = await mod.authenticateAsync({ promptMessage: reason, disableDeviceFallback: false });
    return !!res?.success;
  } catch {
    // A module/OS error is not a user denial — don't lock funds behind it.
    return true;
  }
}

/**
 * The payment gate both choke points call: applies the pref + threshold, then
 * prompts. `sats` null/unknown (token amounts, zero-amount destinations)
 * always prompts — unknown can't be proven under the threshold.
 */
export async function authorizePayment(sats: number | null, reason: string): Promise<boolean> {
  let threshold = 0;
  try {
    const prefs = await loadPrefs();
    if (!prefs.payAuthRequired) return true;
    threshold = Math.max(0, prefs.payAuthThresholdSats || 0);
  } catch { /* prefs unreadable — fail toward prompting */ }
  if (sats != null && Number.isFinite(sats) && sats < threshold) return true;
  return requireAuth(reason);
}
