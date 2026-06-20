/**
 * Voice memo recording & playback — web (MediaRecorder + HTMLAudio).
 * Mirrors voice.ts so App.tsx imports the same API on every platform.
 *
 * Record returns a Blob (handed to upload.uploadFile()), a filename, and the
 * mime type the browser picked. Playback uses a plain HTMLAudioElement.
 */
export interface VoiceClip {
  data: Blob;
  mime: string;
  name: string;
}

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let stream: MediaStream | null = null;
let audioEl: HTMLAudioElement | null = null;

/** Pick the first mime type the browser can record. */
function pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

export async function startRecording(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Recording not supported');
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickMime();
  chunks = [];
  recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.start();
}

export async function stopRecording(): Promise<VoiceClip | null> {
  const rec = recorder;
  if (!rec) return null;
  recorder = null;
  const clip = await new Promise<VoiceClip | null>((resolve) => {
    rec.onstop = () => {
      const mime = rec.mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type: mime });
      chunks = [];
      if (blob.size === 0) { resolve(null); return; }
      const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
      resolve({ data: blob, mime, name: `voice-memo.${ext}` });
    };
    rec.stop();
  });
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  return clip;
}

export function isRecording(): boolean {
  return recorder !== null;
}

export async function playAudio(url: string): Promise<void> {
  if (audioEl) { audioEl.pause(); audioEl = null; }
  audioEl = new Audio(url);
  await audioEl.play();
}
