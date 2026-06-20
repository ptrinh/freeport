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
