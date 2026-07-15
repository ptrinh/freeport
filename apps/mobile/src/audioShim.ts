/**
 * Audio backend shim — expo-audio when its native module is in the binary,
 * expo-av otherwise.
 *
 * expo-av is deprecated (removed in a future SDK) but is the ONLY audio
 * module compiled into binaries shipped before this migration. expo-audio is
 * the replacement but its pod/AAR only exists in binaries built after it was
 * added. OTA updates must keep voice messages, the call ring, and UI sounds
 * working on BOTH, so every entry point probes for the `ExpoAudio` native
 * module (requireOptionalNativeModule — same pattern as src/passkey.ts) and
 * falls back to expo-av when it is missing. Drop the fallback (and the
 * expo-av dependency) once the fleet is on binaries that bundle expo-audio.
 *
 * Note: expo-audio must be imported lazily — its JS throws at import time on
 * binaries without the native module. expo-av imports safely everywhere.
 * On web the probe finds no native module, so web keeps the expo-av path it
 * has today (only calls/ring.ts reaches this file on web; voice/haptics have
 * .web.ts variants that never import this shim).
 */
import { Audio as Av, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';

type ExpoAudioModule = typeof import('expo-audio');

let expoAudio: ExpoAudioModule | null | undefined; // undefined = not probed yet

async function loadExpoAudio(): Promise<ExpoAudioModule | null> {
  if (expoAudio !== undefined) return expoAudio;
  try {
    const core: any = await import('expo-modules-core').catch(() => null);
    expoAudio = core?.requireOptionalNativeModule?.('ExpoAudio')
      ? ((await import('expo-audio')) as ExpoAudioModule)
      : null;
  } catch {
    expoAudio = null;
  }
  return expoAudio;
}

/** Normalized playback status (millis everywhere, like expo-av). */
export interface ShimStatus {
  isLoaded: boolean;
  playing: boolean;
  positionMillis: number;
  /** 0 when unknown (some streams report Infinity/undefined). */
  durationMillis: number;
  didJustFinish: boolean;
}

export interface ShimSound {
  play(): Promise<void>;
  pause(): Promise<void>;
  /** Restart from the top (UI click/notify sounds). */
  replay(): Promise<void>;
  stop(): Promise<void>;
  unload(): Promise<void>;
  setRate(rate: number): Promise<void>;
  setPositionMillis(ms: number): Promise<void>;
  getStatus(): Promise<ShimStatus>;
  setOnStatus(cb: ((st: ShimStatus) => void) | null): void;
}

export interface ShimSoundOptions {
  shouldPlay?: boolean;
  volume?: number;
  isLooping?: boolean;
  progressUpdateIntervalMillis?: number;
}

function normMillis(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Load a sound from a bundled asset (require(...) number) or a remote URL. */
export async function createSound(
  source: number | { uri: string },
  opts: ShimSoundOptions = {},
): Promise<ShimSound> {
  const mod = await loadExpoAudio();
  if (mod) {
    const player = mod.createAudioPlayer(source, {
      updateInterval: opts.progressUpdateIntervalMillis ?? 500,
    });
    if (opts.volume != null) player.volume = opts.volume;
    if (opts.isLooping) player.loop = true;
    let cb: ((st: ShimStatus) => void) | null = null;
    const sub = player.addListener('playbackStatusUpdate', (st) => {
      cb?.({
        isLoaded: st.isLoaded,
        playing: st.playing,
        positionMillis: normMillis(st.currentTime * 1000),
        durationMillis: normMillis(st.duration * 1000),
        didJustFinish: !!st.didJustFinish,
      });
    });
    const handle: ShimSound = {
      play: async () => { player.play(); },
      pause: async () => { player.pause(); },
      replay: async () => { await player.seekTo(0); player.play(); },
      stop: async () => { player.pause(); },
      unload: async () => { sub.remove(); player.remove(); },
      setRate: async (rate) => { player.setPlaybackRate(rate, 'high'); },
      setPositionMillis: async (ms) => { await player.seekTo(ms / 1000); },
      getStatus: async () => ({
        isLoaded: player.isLoaded,
        playing: player.playing,
        positionMillis: normMillis(player.currentTime * 1000),
        durationMillis: normMillis(player.duration * 1000),
        didJustFinish: false,
      }),
      setOnStatus: (fn) => { cb = fn; },
    };
    if (opts.shouldPlay) player.play();
    return handle;
  }

  // Legacy path (old binaries / web): expo-av.
  const { sound } = await Av.Sound.createAsync(source, {
    shouldPlay: opts.shouldPlay,
    volume: opts.volume,
    isLooping: opts.isLooping,
    progressUpdateIntervalMillis: opts.progressUpdateIntervalMillis,
  });
  let cb: ((st: ShimStatus) => void) | null = null;
  sound.setOnPlaybackStatusUpdate((st: any) => {
    if (!st.isLoaded) { cb?.({ isLoaded: false, playing: false, positionMillis: 0, durationMillis: 0, didJustFinish: false }); return; }
    cb?.({
      isLoaded: true,
      playing: !!st.isPlaying,
      positionMillis: normMillis(st.positionMillis),
      durationMillis: normMillis(st.durationMillis),
      didJustFinish: !!st.didJustFinish,
    });
  });
  return {
    play: async () => { await sound.playAsync(); },
    pause: async () => { await sound.pauseAsync(); },
    replay: async () => { await sound.replayAsync(); },
    stop: async () => { await sound.stopAsync(); },
    unload: async () => { await sound.unloadAsync(); },
    setRate: async (rate) => { await sound.setRateAsync(rate, true); },
    setPositionMillis: async (ms) => { await sound.setPositionAsync(ms); },
    getStatus: async () => {
      const st: any = await sound.getStatusAsync();
      if (!st.isLoaded) return { isLoaded: false, playing: false, positionMillis: 0, durationMillis: 0, didJustFinish: false };
      return {
        isLoaded: true,
        playing: !!st.isPlaying,
        positionMillis: normMillis(st.positionMillis),
        durationMillis: normMillis(st.durationMillis),
        didJustFinish: !!st.didJustFinish,
      };
    },
    setOnStatus: (fn) => { cb = fn; },
  };
}

// ---------------------------------------------------------------- recording

export interface ShimRecorder {
  /** Stop and return the recorded file URI (null if nothing captured). */
  stop(): Promise<string | null>;
}

export async function requestRecordingPermissions(): Promise<boolean> {
  const mod = await loadExpoAudio();
  const perm = mod ? await mod.requestRecordingPermissionsAsync() : await Av.requestPermissionsAsync();
  return !!perm.granted;
}

/** Toggle the mic-capable audio session (allows recording + plays in silence). */
export async function setRecordingMode(active: boolean): Promise<void> {
  const mod = await loadExpoAudio();
  if (mod) {
    await mod.setAudioModeAsync(
      active ? { allowsRecording: true, playsInSilentMode: true } : { allowsRecording: false },
    );
  } else {
    await Av.setAudioModeAsync(
      active ? { allowsRecordingIOS: true, playsInSilentModeIOS: true } : { allowsRecordingIOS: false },
    );
  }
}

/** UI-sound session: mix with the user's music, never override the mute switch. */
export async function setSfxMode(): Promise<void> {
  const mod = await loadExpoAudio();
  if (mod) {
    await mod.setAudioModeAsync({
      playsInSilentMode: false,
      interruptionMode: 'mixWithOthers',
      interruptionModeAndroid: 'duckOthers',
    });
  } else {
    await Av.setAudioModeAsync({
      playsInSilentModeIOS: false,
      interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      shouldDuckAndroid: true,
    });
  }
}

/** Start a HIGH_QUALITY (.m4a on both platforms) voice recording. */
export async function startRecorder(): Promise<ShimRecorder> {
  const mod = await loadExpoAudio();
  if (mod) {
    const rec = new mod.AudioModule.AudioRecorder(mod.RecordingPresets.HIGH_QUALITY);
    await rec.prepareToRecordAsync();
    rec.record();
    return {
      stop: async () => {
        await rec.stop();
        const uri = rec.uri;
        try { rec.release(); } catch { /* already released */ }
        return uri;
      },
    };
  }
  const { recording } = await Av.Recording.createAsync(Av.RecordingOptionsPresets.HIGH_QUALITY);
  return {
    stop: async () => {
      await recording.stopAndUnloadAsync();
      return recording.getURI();
    },
  };
}
