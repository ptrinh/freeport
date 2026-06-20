/**
 * Tactile + audible feedback (native).
 *
 * - `wheelTick()` — a detent of the amount wheel: a firm Taptic impact (iOS) /
 *   short vibration (Android) plus a quiet click sound. Throttled to ~35ms so a
 *   fast inertia coast doesn't queue/drop on the Taptic Engine or stutter audio.
 * - `eventAlert()` — a new request appeared or a message arrived: a notification
 *   haptic + a two-tone "di-ding". Throttled to collapse bursts.
 *
 * Sounds are tiny bundled WAVs (ship over-the-air, no rebuild) played via
 * expo-av (already in the binary). expo-haptics is requireOptionalNativeModule
 * → null on builds without it, so haptic calls are guarded to no-op safely.
 * Web has its own variant (haptics.web.ts).
 */
import { Platform, Vibration } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';

let clickSound: Audio.Sound | null = null;
let notifySound: Audio.Sound | null = null;
let celebrateSound: Audio.Sound | null = null;
let loaded = false;

async function ensureSounds(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    // Mix with the user's music; never force playback through the iOS mute
    // switch (a UI click that ignores silent mode would be obnoxious).
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: false,
      interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      shouldDuckAndroid: true,
    });
    clickSound = (await Audio.Sound.createAsync(require('../assets/click.wav'), { volume: 0.09 })).sound;
    notifySound = (await Audio.Sound.createAsync(require('../assets/notify.wav'), { volume: 0.9 })).sound;
    celebrateSound = (await Audio.Sound.createAsync(require('../assets/celebrate.wav'), { volume: 0.9 })).sound;
  } catch { /* sounds unavailable — haptics still work */ }
}
ensureSounds();

let lastTick = 0;
export function wheelTick(): void {
  const now = Date.now();
  if (now - lastTick < 35) return; // keep the Taptic Engine + audio in step on a fast coast
  lastTick = now;
  if (Platform.OS === 'android') {
    try { Vibration.vibrate(5); } catch { /* ignore */ }
  } else if (Platform.OS === 'ios') {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); } catch { /* no module */ }
  }
  try { clickSound?.replayAsync().catch(() => {}); } catch { /* not loaded yet */ }
}

let lastAlert = 0;
export function eventAlert(): void {
  const now = Date.now();
  if (now - lastAlert < 800) return; // collapse rapid bursts into one alert
  lastAlert = now;
  if (Platform.OS === 'android') {
    try { Vibration.vibrate([0, 40, 70, 40]); } catch { /* ignore */ }
  } else if (Platform.OS === 'ios') {
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); } catch { /* no module */ }
  }
  if (!loaded) ensureSounds();
  try { notifySound?.replayAsync().catch(() => {}); } catch { /* not loaded yet */ }
}

/** Celebration "tada" + a success haptic — deal completed / onboarding done. */
export function playCelebrate(): void {
  if (Platform.OS === 'android') {
    try { Vibration.vibrate([0, 30, 50, 30, 50, 60]); } catch { /* ignore */ }
  } else if (Platform.OS === 'ios') {
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); } catch { /* no module */ }
  }
  if (!loaded) ensureSounds();
  try { celebrateSound?.replayAsync().catch(() => {}); } catch { /* not loaded yet */ }
}
