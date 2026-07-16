/**
 * Clipboard helper. expo-clipboard is PRE-LINKED in the binary (like
 * expo-image) but may be absent from an already-installed build, so we probe
 * the native module before importing it — the same optional-native-module
 * guard used by passkey.ts / cameraModule.ts. Where there's no real clipboard
 * (native binary without the module) we fall back to the OS share sheet.
 *
 * Web uses navigator.clipboard directly.
 */
import { Platform, Share } from 'react-native';

let checked = false;
let native: { setStringAsync: (s: string) => Promise<boolean | void> } | null = null;

async function nativeClipboard() {
  if (checked) return native;
  checked = true;
  try {
    const core = await import('expo-modules-core');
    if (core?.requireOptionalNativeModule?.('ExpoClipboard')) {
      native = await import('expo-clipboard');
    }
  } catch { native = null; }
  return native;
}

/** Whether a real clipboard write is available right now — web, or a native
 *  binary that pre-linked expo-clipboard. Lets a button label itself "Copy"
 *  vs "Share" honestly. */
export async function clipboardAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return !!(globalThis.navigator as Navigator & { clipboard?: { writeText?: (t: string) => Promise<void> } })?.clipboard?.writeText;
  return !!(await nativeClipboard());
}

/**
 * Copy `text`. Returns true on a real clipboard write. On a native binary with
 * no clipboard module it invokes `shareFallback` (or opens the share sheet) and
 * returns false, so callers can label/track the two outcomes.
 */
export async function copyText(text: string, shareFallback?: () => void): Promise<boolean> {
  if (Platform.OS === 'web') {
    try { await (globalThis.navigator as Navigator & { clipboard?: { writeText?: (t: string) => Promise<void> } })?.clipboard?.writeText?.(text); return true; } catch { return false; }
  }
  const cb = await nativeClipboard();
  if (cb) { try { await cb.setStringAsync(text); return true; } catch { /* fall through to share */ } }
  if (shareFallback) shareFallback();
  else { try { await Share.share({ message: text }); } catch { /* dismissed */ } }
  return false;
}
