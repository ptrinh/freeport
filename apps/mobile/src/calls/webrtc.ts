/**
 * WebRTC platform shim. Web uses the browser globals; native probes for the
 * react-native-webrtc module BEFORE importing it — the module only exists in
 * 1.6.0+ binaries (ship-ahead policy), and importing a missing native module
 * throws at module-init where try/catch can't reach (crash class #12–#15;
 * same pattern as cameraModule.ts / breezNative.ts).
 */
import { NativeModules, Platform } from 'react-native';

export interface RTC {
  RTCPeerConnection: new (config: any) => any;
  mediaDevices: { getUserMedia(constraints: any): Promise<any> };
  /** Native-only <RTCView> component; web renders a DOM <video> instead. */
  RTCView?: any;
}

/** Cheap capability probe — safe to call anywhere (drives button visibility). */
export function callsSupported(): boolean {
  if (Platform.OS === 'web') {
    const g = globalThis as any;
    return typeof g.RTCPeerConnection === 'function' && !!g.navigator?.mediaDevices?.getUserMedia;
  }
  try {
    return NativeModules.WebRTCModule != null;
  } catch {
    return false;
  }
}

let cached: RTC | null | undefined;

export async function loadRTC(): Promise<RTC | null> {
  if (cached !== undefined) return cached;
  if (!callsSupported()) return (cached = null);
  if (Platform.OS === 'web') {
    const g = globalThis as any;
    cached = { RTCPeerConnection: g.RTCPeerConnection, mediaDevices: g.navigator.mediaDevices };
    return cached;
  }
  try {
    const m = await import('react-native-webrtc');
    cached = { RTCPeerConnection: (m as any).RTCPeerConnection, mediaDevices: (m as any).mediaDevices, RTCView: (m as any).RTCView };
  } catch {
    cached = null; // probe passed but import failed — treat as unsupported
  }
  return cached;
}

/** Test hook. */
export function __setRTCForTests(rtc: RTC | null | undefined): void {
  cached = rtc;
}
