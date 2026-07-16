/**
 * Voice memo recording & playback — native (expo-audio, with an expo-av
 * fallback for binaries shipped before expo-audio was added; see audioShim).
 * The web build swaps in voice.web.ts (MediaRecorder + HTMLAudio).
 *
 * Record returns the data to hand to upload.uploadFile(): a local file URI
 * (native) plus a filename and mime type. Playback streams the uploaded URL.
 */
import {
  createSound,
  requestRecordingPermissions,
  setRecordingMode,
  startRecorder,
  type ShimRecorder,
  type ShimSound,
} from './audioShim';

export interface VoiceClip {
  data: string; // local file URI on native
  mime: string;
  name: string;
}

let recording: ShimRecorder | null = null;
let sound: ShimSound | null = null;

/** Begin recording. Throws if mic permission is denied. */
export async function startRecording(): Promise<void> {
  const granted = await requestRecordingPermissions();
  if (!granted) throw new Error('Microphone permission denied');
  await setRecordingMode(true);
  recording = await startRecorder();
}

/** Stop recording and return the clip, or null if nothing was recorded. */
export async function stopRecording(): Promise<VoiceClip | null> {
  if (!recording) return null;
  const rec = recording;
  recording = null;
  let uri: string | null;
  try {
    uri = await rec.stop();
    await setRecordingMode(false);
  } catch {
    return null;
  }
  if (!uri) return null;
  const ext = uri.split('.').pop()?.toLowerCase() ?? 'm4a';
  const mime = ext === 'caf' ? 'audio/x-caf' : ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
  return { data: uri, mime, name: `voice-memo.${ext}` };
}

/** Whether a recording is currently in progress. */
export function isRecording(): boolean {
  return recording !== null;
}

/** Play an uploaded audio URL. Stops any previous playback first. */
export interface VoicePlayback {
  playing: boolean;
  positionMillis: number;
  durationMillis: number;
  done?: boolean;
  /** Playback speed (1 or 2) — WhatsApp-style, remembered across clips. */
  rate?: number;
}

// ONE clip plays at a time (WhatsApp behavior): starting another stops the
// previous and notifies its bubble so its UI resets.
let currentUrl: string | null = null;
let currentListener: ((st: VoicePlayback) => void) | null = null;
let playbackRate = 1;

/** Current playback speed (applies to the next clip too). */
export function voiceRate(): number {
  return playbackRate;
}

/** Set playback speed (1 or 2); applies immediately to the playing clip. */
export async function setVoiceRate(rate: number): Promise<void> {
  playbackRate = rate;
  if (sound) {
    try { await sound.setRate(rate); } catch { /* not loaded */ }
  }
}

/** Jump to a fraction (0–1) of the clip; starts playback if needed. Clips
 *  with unknown duration (some web streams) can't seek — silently skipped. */
export async function seekVoice(url: string, fraction: number, onStatus: (st: VoicePlayback) => void): Promise<void> {
  if (currentUrl !== url || !sound) await toggleVoice(url, onStatus);
  else currentListener = onStatus;
  const s = sound;
  if (!s) return;
  const st = await s.getStatus();
  if (!st.isLoaded) return;
  if (st.durationMillis > 0) {
    await s.setPositionMillis(Math.max(0, Math.min(1, fraction)) * st.durationMillis);
  }
  if (!st.playing) await s.play().catch(() => {});
}

/** Toggle play/pause for a clip; starting a different clip stops the last. */
export async function toggleVoice(url: string, onStatus: (st: VoicePlayback) => void): Promise<void> {
  if (currentUrl === url && sound) {
    currentListener = onStatus; // rebind (bubble re-mounted)
    const st = await sound.getStatus();
    if (st.isLoaded) {
      if (st.playing) await sound.pause();
      else await sound.play();
      return;
    }
  }
  // Different clip (or dead sound): stop the old one and tell its bubble.
  if (sound) {
    try { await sound.unload(); } catch { /* already gone */ }
    currentListener?.({ playing: false, positionMillis: 0, durationMillis: 0, done: true });
    sound = null;
  }
  const s = await createSound({ uri: url }, { shouldPlay: true, progressUpdateIntervalMillis: 250 });
  sound = s;
  currentUrl = url;
  currentListener = onStatus;
  s.setOnStatus((st) => {
    if (!st.isLoaded) return;
    // Unknown durations are already normalized to 0 by the shim, so the UI
    // falls back to elapsed-time display instead of a dead bubble.
    currentListener?.({
      playing: st.playing,
      positionMillis: st.positionMillis,
      durationMillis: st.durationMillis,
      done: st.didJustFinish,
      rate: playbackRate,
    });
    if (st.didJustFinish) {
      s.unload().catch(() => {});
      if (sound === s) { sound = null; currentUrl = null; }
    }
  });
  if (playbackRate !== 1) await s.setRate(playbackRate).catch(() => {});
  // Belt-and-braces: some expo-av web versions ignore shouldPlay in the
  // initial status when created from an async chain.
  await s.play().catch(() => {});
}

export async function playAudio(url: string): Promise<void> {
  try {
    if (sound) { await sound.unload(); sound = null; }
  } catch { /* ignore */ }
  const s = await createSound({ uri: url }, { shouldPlay: true });
  sound = s;
  s.setOnStatus((st) => {
    if (st.isLoaded && st.didJustFinish) { s.unload().catch(() => {}); if (sound === s) sound = null; }
  });
}
