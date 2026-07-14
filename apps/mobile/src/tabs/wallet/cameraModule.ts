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
export function hasExpoNativeModule(name: string): boolean {
  try {
    const req = (ExpoCore as any).requireOptionalNativeModule;
    // Check BOTH layers: on some binaries requireOptionalNativeModule returns
    // null even though the module sits in the JSI registry (Scan button
    // missing on a 1.5.2 store build that demonstrably ships ExpoCamera).
    if (typeof req === 'function' && !!req(name)) return true;
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
  // Race the import against a timeout: a module whose init error lands on the
  // GLOBAL handler leaves the import promise unsettled forever — the button
  // would silently never appear and no diagnostic would fire.
  const cam = await Promise.race([
    importCamera(),
    new Promise((resolve) => setTimeout(() => resolve('__timeout__'), 4000)),
  ]);
  if (cam === '__timeout__') {
    reportProbeFailure('import-hang');
    return false;
  }
  const ok = !!(cam as any)?.CameraView;
  if (!ok) reportProbeFailure(cam);
  return ok;
}

/** One diagnostic per launch: a 1.5.2 store binary that verifiably ships
 *  ExpoCamera still hides Scan (user report) — capture WHICH probe layer
 *  failed so GlitchTip tells us instead of guessing. Remove once solved. */
let probeReported = false;
function reportProbeFailure(cam: any): void {
  // 'import-hang' arrives as a string marker instead of a module object.
  if (probeReported) return;
  probeReported = true;
  try {
    const req = (ExpoCore as any).requireOptionalNativeModule;
    const registry = (globalThis as any).expo?.modules;
    // Deferred import keeps telemetry out of this module's init path.
    import('../../telemetry').then(({ captureError }) => {
      captureError(new Error('scan probe failed'), {
        hasRequireOptional: typeof req === 'function',
        reqResult: typeof req === 'function' ? String(!!req('ExpoCamera')) : 'n/a',
        registryHasCamera: String(!!registry?.ExpoCamera),
        registryKeys: registry ? Object.keys(registry).filter((k) => /cam/i.test(k)).join(',') || '(none match /cam/)' : '(no registry)',
        importReturned: cam === null ? 'null' : typeof cam,
        camExports: cam ? Object.keys(cam).slice(0, 12).join(',') : '',
      });
    }).catch(() => {});
  } catch { /* diagnostics must never break the wallet */ }
}
