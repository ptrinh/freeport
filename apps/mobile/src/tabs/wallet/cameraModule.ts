import { Platform } from 'react-native';

/**
 * Guarded access to expo-camera. Its JS calls requireNativeModule('ExpoCamera')
 * at module-init, which THROWS on binaries built before the module was added
 * (runtime <= 1.4.1). Crucially, Metro runs module factories inside
 * guardedLoadModule, which reports init errors straight to the GLOBAL error
 * handler (ErrorUtils.reportFatalError) — a try/catch around import() never
 * sees them (GlitchTip issue 12). So probe the native side first via
 * expo-modules-core (present in every binary): requireOptionalNativeModule
 * returns null instead of throwing.
 */
export async function importCamera(): Promise<any | null> {
  try {
    const core: any = await import('expo-modules-core');
    if (!core?.requireOptionalNativeModule?.('ExpoCamera')) return null;
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
