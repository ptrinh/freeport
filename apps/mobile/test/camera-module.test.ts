/**
 * REGRESSIONS this locks in:
 *
 *  (#12) OTA bundles run on binaries built BEFORE expo-camera was added
 *  (runtime <= 1.4.1). expo-camera's module init throws "Cannot find native
 *  module 'ExpoCamera'", and Metro reports that to the GLOBAL error handler —
 *  try/catch around import('expo-camera') never fires. The guard must probe
 *  expo-modules-core FIRST and never import expo-camera's JS when absent.
 *
 *  (#101) On binaries that DO ship the camera (1.5.x), the Scan button must
 *  appear. If `requireOptionalNativeModule` is missing from the bundled
 *  expo-modules-core, `undefined?.('ExpoCamera')` yields undefined and a naive
 *  `!probe` reads as "absent" — hiding Scan on a camera-capable build. The
 *  guard must fall back to the JSI registry `globalThis.expo.modules`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

// Toggles the test drives. reqFnPresent=false simulates a bundled
// expo-modules-core WITHOUT the requireOptionalNativeModule export.
let nativeModulePresent = true;
let reqFnPresent = true;
const cameraImported = vi.fn();

vi.mock('expo-modules-core', () => ({
  // getter so each test sees the current toggle via the live namespace binding
  get requireOptionalNativeModule() {
    if (!reqFnPresent) return undefined;
    return (name: string) => (nativeModulePresent && name === 'ExpoCamera' ? {} : null);
  },
}));
vi.mock('expo-camera', () => {
  cameraImported();
  if (!nativeModulePresent) throw new Error("Cannot find native module 'ExpoCamera'");
  return { CameraView: function CameraView() {}, Camera: {} };
});

import { importCamera, scanSupported } from '../src/tabs/wallet/cameraModule';

beforeEach(() => { cameraImported.mockClear(); nativeModulePresent = true; reqFnPresent = true; });
afterEach(() => { delete (globalThis as any).expo; });

describe('importCamera via requireOptionalNativeModule (#12 guard)', () => {
  it('native module missing → null, and expo-camera JS is NEVER imported', async () => {
    nativeModulePresent = false;
    expect(await importCamera()).toBeNull();
    expect(cameraImported).not.toHaveBeenCalled();
  });

  it('native module present → returns the module', async () => {
    nativeModulePresent = true;
    expect((await importCamera())?.CameraView).toBeTruthy();
  });
});

describe('fallback when requireOptionalNativeModule is absent (#101)', () => {
  it('camera present in JSI registry → Scan still enabled', async () => {
    reqFnPresent = false;
    (globalThis as any).expo = { modules: { ExpoCamera: {} } };
    expect(await scanSupported()).toBe(true);
  });

  it('no export AND no JSI registry entry → Scan hidden, no crash', async () => {
    reqFnPresent = false;
    (globalThis as any).expo = { modules: {} };
    expect(await scanSupported()).toBe(false);
    expect(cameraImported).not.toHaveBeenCalled();
  });

  it('no export and no expo global at all → Scan hidden', async () => {
    reqFnPresent = false;
    expect(await scanSupported()).toBe(false);
  });
});

describe('scanSupported (native, normal path)', () => {
  it('false on pre-camera binaries (Scan button hidden, no crash)', async () => {
    nativeModulePresent = false;
    expect(await scanSupported()).toBe(false);
    expect(cameraImported).not.toHaveBeenCalled();
  });

  it('true when the binary ships ExpoCamera', async () => {
    nativeModulePresent = true;
    expect(await scanSupported()).toBe(true);
  });
});
