/**
 * REGRESSION (GlitchTip issue 12): OTA bundles run on binaries built BEFORE
 * expo-camera was added (runtime <= 1.4.1). expo-camera's module init throws
 * "Cannot find native module 'ExpoCamera'", and Metro reports that to the
 * GLOBAL error handler — try/catch around import('expo-camera') never fires.
 * The guard must therefore probe expo-modules-core FIRST and never import
 * expo-camera's JS when the native module is absent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const cameraImported = vi.fn();
let nativeModulePresent = true;

vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) =>
    nativeModulePresent && name === 'ExpoCamera' ? {} : null,
}));
vi.mock('expo-camera', () => {
  cameraImported();
  if (!nativeModulePresent) throw new Error("Cannot find native module 'ExpoCamera'");
  return { CameraView: function CameraView() {}, Camera: {} };
});

import { importCamera, scanSupported } from '../src/tabs/wallet/cameraModule';

beforeEach(() => { cameraImported.mockClear(); });

describe('importCamera (old-binary guard)', () => {
  it('native module missing → null, and expo-camera JS is NEVER imported', async () => {
    nativeModulePresent = false;
    expect(await importCamera()).toBeNull();
    expect(cameraImported).not.toHaveBeenCalled();
  });

  it('native module present → returns the module', async () => {
    nativeModulePresent = true;
    const cam = await importCamera();
    expect(cam?.CameraView).toBeTruthy();
  });
});

describe('scanSupported (native)', () => {
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
