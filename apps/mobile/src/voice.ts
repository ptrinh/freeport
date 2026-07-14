/**
 * Voice memo recording & playback — native (expo-av).
 * The web build swaps in voice.web.ts (MediaRecorder + HTMLAudio).
 *
 * Record returns the data to hand to upload.uploadFile(): a local file URI
 * (native) plus a filename and mime type. Playback streams the uploaded URL.
 */
import { Audio } from 'expo-av';

export interface VoiceClip {
  data: string; // local file URI on native
  mime: string;
  name: string;
}

let recording: Audio.Recording | null = null;
let sound: Audio.Sound | null = null;

/** Begin recording. Throws if mic permission is denied. */
export async function startRecording(): Promise<void> {
  const perm = await Audio.requestPermissionsAsync();
  if (!perm.granted) throw new Error('Microphone permission denied');
  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  const { recording: rec } = await Audio.Recording.createAsync(
    Audio.RecordingOptionsPresets.HIGH_QUALITY,
  );
  recording = rec;
}

/** Stop recording and return the clip, or null if nothing was recorded. */
export async function stopRecording(): Promise<VoiceClip | null> {
  if (!recording) return null;
  const rec = recording;
  recording = null;
  try {
    await rec.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
  } catch {
    return null;
  }
  const uri = rec.getURI();
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
}

// ONE clip plays at a time (WhatsApp behavior): starting another stops the
// previous and notifies its bubble so its UI resets.
let currentUrl: string | null = null;
let currentListener: ((st: VoicePlayback) => void) | null = null;

/** Toggle play/pause for a clip; starting a different clip stops the last. */
export async function toggleVoice(url: string, onStatus: (st: VoicePlayback) => void): Promise<void> {
  if (currentUrl === url && sound) {
    currentListener = onStatus; // rebind (bubble re-mounted)
    const st: any = await sound.getStatusAsync();
    if (st.isLoaded) {
      if (st.isPlaying) await sound.pauseAsync();
      else await sound.playAsync();
      return;
    }
  }
  // Different clip (or dead sound): stop the old one and tell its bubble.
  if (sound) {
    try { await sound.unloadAsync(); } catch { /* already gone */ }
    currentListener?.({ playing: false, positionMillis: 0, durationMillis: 0, done: true });
    sound = null;
  }
  const { sound: s } = await Audio.Sound.createAsync(
    { uri: url },
    { shouldPlay: true, progressUpdateIntervalMillis: 250 },
  );
  sound = s;
  currentUrl = url;
  currentListener = onStatus;
  s.setOnPlaybackStatusUpdate((st: any) => {
    if (!st.isLoaded) return;
    // Web streams can report Infinity/undefined duration — normalize to 0 so
    // the UI falls back to elapsed-time display instead of a dead bubble.
    const dur = Number.isFinite(st.durationMillis) ? st.durationMillis : 0;
    currentListener?.({
      playing: !!st.isPlaying,
      positionMillis: st.positionMillis ?? 0,
      durationMillis: dur,
      done: !!st.didJustFinish,
    });
    if (st.didJustFinish) {
      s.unloadAsync().catch(() => {});
      if (sound === s) { sound = null; currentUrl = null; }
    }
  });
  // Belt-and-braces: some expo-av web versions ignore shouldPlay in the
  // initial status when created from an async chain.
  await s.playAsync().catch(() => {});
}

export async function playAudio(url: string): Promise<void> {
  try {
    if (sound) { await sound.unloadAsync(); sound = null; }
  } catch {}
  const { sound: s } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
  sound = s;
  s.setOnPlaybackStatusUpdate((st) => {
    if (st.isLoaded && st.didJustFinish) { s.unloadAsync().catch(() => {}); if (sound === s) sound = null; }
  });
}
