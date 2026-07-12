import { Platform } from 'react-native';
// Static import (namespace): a dynamic import('…') namespace copy can fire
// lazy getters on the module object (see breezNative.ts / GlitchTip #15).
import * as ExpoCore from 'expo-modules-core';

/**
 * Is an Expo native module present in THIS binary? Mirrors exactly what
 * expo-camera does internally — `requireNativeModule('ExpoCamera')` — but
 * without throwing. Two layers of defence:
 *  1. `requireOptionalNativeModule` (the documented, null-returning API).
 *  2. If that export is somehow missing from the bundled expo-modules-core,
 *     fall back to the JSI registry `globalThis.expo.modules[name]` directly
 *     — otherwise an `undefined?.()` call would mis-read as "absent" and hide
 *     the Scan button on binaries that DO ship the camera.
 */
function hasExpoNativeModule(name: string): boolean {
  try {
    const req = (ExpoCore as any).requireOptionalNativeModule;
    if (typeof req === 'function') return !!req(name);
    return !!(globalThis as any).expo?.modules?.[name];
  } catch {
    return false;
  }
}

/**
 * Guarded access to expo-camera. Its JS calls requireNativeModule('ExpoCamera')
 * at module-init, which THROWS on binaries built before the module was added
 * (runtime <= 1.4.1). Metro runs module factories inside guardedLoadModule and
 * reports init errors to the GLOBAL error handler, so a try/catch around
 * import() never sees them (GlitchTip #12). Probe the native side first.
 */
export async function importCamera(): Promise<any | null> {
  if (!hasExpoNativeModule('ExpoCamera')) return null;
  try {
    return await import('expo-camera');
  } catch {
    return null;
  }
}

/** Scan button visibility: web needs getUserMedia in a secure context; native
 *  needs the expo-camera native module in THIS binary. */
export async function scanSupported(): Promise<boolean> {
  if (Platform.OS === 'web') {
    try {
      return !!(navigator as any)?.mediaDevices?.getUserMedia && (window as any).isSecureContext === true;
    } catch { return false; }
  }
  const cam = await importCamera();
  return !!cam?.CameraView;
}
